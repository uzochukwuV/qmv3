// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import "./interfaces/ITypes.sol";
import "./libraries/LibOdds.sol";
import "./libraries/LibGroupDiscount.sol";

/// @title QuadraticMarket
/// @notice Decentralized fixed-odds sports betting protocol.
///
/// Architecture summary
/// ─────────────────────
/// • MarketGroup = a real-world event (e.g. "Arsenal vs Chelsea").
///   One group holds multiple Markets — one per bet type.
///
/// • Market = an individual betting market (e.g. "Over 2.5 Goals" inside the
///   Arsenal vs Chelsea group). Each Market has a GroupType that describes
///   what kind of bet it is (FTR, Goals, BTTS, AsianHandicap, …).
///
/// • Odds are fixed/semi-static: set by an oracle at market creation and
///   updated by oracle calls. No LMSR. Payout = stake × odds / ODDS_PRECISION.
///
/// • LP vault backs all markets in an epoch. maxExposureMultiplierBps limits
///   total LP loss per epoch (e.g. 1.5× means LP can lose at most 50% of deposit).
///
/// • Multi-leg bet slips apply a same-match correlation discount via LibGroupDiscount.
///
/// Phase 1 — Core storage, initialization, admin, epoch management
/// Phase 2 — LP vault: addLiquidity, requestWithdraw, processWithdrawal,
///            sport-category voting, exposure-cap enforcement
///
/// Phases 3–7 add functions without touching storage layout.

contract QuadraticMarket is ReentrancyGuard, IQuadraticMarketEvents, IQuadraticMarketErrors {
    using SafeERC20 for IERC20;
    using LibOdds for uint256;

    // ─── Protocol configuration ───────────────────────────────────────────────

    address public admin;
    bool    public paused;

    /// @dev Oracle address that signs updateOdds and proposeResult calls.
    ///      Verified via ecrecover on-chain — no trusted executor, just a keypair.
    address public oracle;

    /// @notice Global max USDC exposure per market (overridable per market).
    uint256 public maxMarketExposure;

    /// @notice Total outstanding payout obligations across all live markets.
    uint256 public totalLockedPayouts;

    /// @notice Total LP shares in circulation (ERC4626-style NAV denominator).
    uint256 public totalLpShares;

    /// @notice ERC20 base token (USDC or equivalent 6-decimal stablecoin).
    IERC20  public baseToken;

    /// @notice Protocol treasury — holds all LP deposits and collected stakes.
    address public treasury;

    /// @notice Monotonically incrementing market ID counter.
    uint64  public nextMarketId;

    /// @notice Monotonically incrementing market group ID counter.
    uint64  public nextGroupId;

    /// @notice Monotonically incrementing bet slip ID counter.
    uint64  public nextSlipId;

    /// @notice Monotonically incrementing order ID counter.
    uint64  public nextOrderId;

    // ── Timing parameters ──────────────────────────────────────────────────────

    /// @notice Seconds after oracle proposes result during which admin can override.
    uint256 public challengeWindowSeconds;

    /// @notice Seconds after market startTime before oracle must settle (else market voidable).
    uint256 public settlementDeadlineSeconds;

    /// @notice Cooldown after LP requests withdrawal before it can be processed.
    uint256 public withdrawalCooldownSeconds;

    // ── Fee / risk parameters ──────────────────────────────────────────────────

    /// @notice House margin applied per leg on bet slips (in BPS).
    uint256 public slipHouseMarginBps;

    /// @notice Max parlay bonus multiplier across all legs (in BPS).
    uint256 public maxSlipBonusMultiplierBps;

    /// @notice Bonus per independent cross-match leg pair (in BPS).
    uint256 public crossMatchBonusPerPairBps;

    /// @notice Max single-bet stake in base token units.
    uint256 public maxSingleBet;

    /// @notice House cut on early cash-out (in BPS).
    uint256 public cashOutMarginBps;

    /// @notice House fee on direct single-outcome purchases (in BPS).
    uint256 public buyFeeBps;

    // ── Epoch state ────────────────────────────────────────────────────────────

    uint64  public currentEpoch;
    uint256 public epochDurationSeconds;
    bool    public epochPaused;
    uint256 public nextEpochStart;

    /// @notice Set to true the first time advanceEpoch() successfully completes.
    ///         LP share withdrawals require at least one epoch to have fully settled.
    bool    public anyEpochSettled;

    // ── Operators (can create/suspend/settle markets) ──────────────────────────

    address[MAX_OPERATORS] private _operators;
    uint8   public numOperators;

    // ─── Storage mappings ─────────────────────────────────────────────────────

    /// @notice All betting markets by ID.
    mapping(uint64 => Market) public markets;

    /// @notice All epochs by ID.
    mapping(uint64 => Epoch) public epochs;

    /// @notice All bet slips by ID.
    mapping(uint64 => BetSlip) public betSlips;

    /// @notice All market groups (events) by group ID.
    mapping(uint64 => MarketGroup) public marketGroups;

    /// @notice Peer-to-peer limit orders by order ID.
    mapping(uint64 => Order) public orders;

    /// @notice Settlement disputes by market ID.
    mapping(uint64 => Dispute) public disputes;

    /// @notice LP share balances.
    mapping(address => uint256) public lpShares;

    /// @notice Pending queued withdrawal requests.
    mapping(address => WithdrawalRequest) public withdrawalRequests;

    /// @notice Pending queued LP deposits (activated next epoch).
    mapping(address => PendingLiquidity) public pendingLiquidity;

    /// @notice Outcome payout shares: bettor → marketId → outcomeId → payout units.
    ///         Minted on buyAtOdds (value = full payout if outcome wins).
    ///         Burned on claimPayout. Used as the win-claim amount.
    mapping(address => mapping(uint64 => mapping(uint8 => uint256))) public outcomeBalances;

    /// @notice USDC stake per position: bettor → marketId → outcomeId → stake paid.
    ///         Recorded alongside outcomeBalances so voided markets can refund exact stakes
    ///         (payout units ≠ stake — they differ by the odds multiplier).
    mapping(address => mapping(uint64 => mapping(uint8 => uint256))) public outcomeStakes;

    /// @notice Per-LP deposit tracking per epoch for NAV calculation.
    mapping(address => mapping(uint64 => uint256)) public lpDepositsPerEpoch;

    // ── Slip token ownership (ERC721-like primitives for P2P marketplace) ──────
    // NOTE: betSlips and nextSlipId are already declared in the main storage block above.

    /// @notice Current owner of a slip. Set to placer at creation;
    ///         updated by transferSlip. Receiver of payout / void-refund.
    mapping(uint64 => address) public slipOwner;

    /// @notice Single-address per-slip transfer approval (cleared on transfer).
    mapping(uint64 => address) public slipApproved;

    /// @notice Operator approval — owner grants an address rights over ALL their slips.
    ///         Intended for the Phase 6 P2P marketplace contract.
    mapping(address => mapping(address => bool)) public slipOperatorApprovals;

    /// @notice USDC locked per open back-order (separate from LP pool).
    uint256 public orderCollateralLocked;

    // ── LP category voting ─────────────────────────────────────────────────────
    /// @notice Total vote-weight per sport category per epoch.
    ///         epochCategoryVotes[epochId][uint8(SportCategory)] → totalShares voted
    mapping(uint64 => mapping(uint8 => uint256)) public epochCategoryVotes;

    /// @notice Track which category each LP voted for per epoch (prevents double-voting).
    ///         lpCategoryVote[lp][epochId] → uint8(SportCategory) + 1  (0 = not yet voted)
    mapping(address => mapping(uint64 => uint8)) public lpCategoryVote;

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 private constant MIN_FIRST_LIQUIDITY = 1_000; // inflation attack guard
    uint8   private constant NUM_SPORT_CATEGORIES = 6;    // must match SportCategory enum

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyAdmin() {
        if (msg.sender != admin) revert Unauthorized();
        _;
    }

    modifier onlyAuthorized() {
        if (!_isAuthorized(msg.sender)) revert Unauthorized();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ProtocolIsPaused();
        _;
    }

    modifier validMarket(uint64 marketId) {
        if (markets[marketId].marketId == 0 && marketId != 0) revert InvalidMarketStatus();
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    /// @param _baseToken       USDC (or any 6-decimal ERC20) used for all stakes/payouts.
    /// @param _oracle          Address whose ECDSA signatures authorize odds updates & settlement.
    /// @param _maxExposure     Default max per-market LP exposure (in base token units).
    constructor(
        address _baseToken,
        address _oracle,
        uint256 _maxExposure
    ) {
        if (_baseToken == address(0)) revert ZeroAddress();
        if (_oracle    == address(0)) revert ZeroAddress();

        admin    = msg.sender;
        treasury = address(this); // contract holds all funds; sub-accounting via storage
        oracle   = _oracle;
        baseToken = IERC20(_baseToken);
        maxMarketExposure = _maxExposure;

        // ── Default protocol parameters ────────────────────────────────────────
        challengeWindowSeconds    = 300;        // 5 minutes
        settlementDeadlineSeconds = 14_400;     // 4 hours
        withdrawalCooldownSeconds = 86_400;     // 24 hours
        epochDurationSeconds      = 86_400;     // 24 hours
        slipHouseMarginBps        = 500;        // 5% per leg
        maxSlipBonusMultiplierBps = 30_000;     // 3.0× max parlay bonus
        crossMatchBonusPerPairBps = 100;        // +1% per independent cross-match pair
        maxSingleBet              = 10_000_000_000; // 10 000 USDC (6-decimal)
        cashOutMarginBps          = 500;        // 5% early exit cut
        buyFeeBps                 = 100;        // 1% direct purchase fee
        nextMarketId              = 1;
        nextGroupId               = 1;
        nextSlipId                = 1;
        nextOrderId               = 1;

        // Initialize epoch 0
        currentEpoch   = 0;
        nextEpochStart = block.timestamp + epochDurationSeconds;

        emit AdminTransferred(address(0), msg.sender);
    }

    // ─── Admin & Operator Management ─────────────────────────────────────────

    /// @notice Transfer protocol admin to a new address.
    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ZeroAddress();
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    /// @notice Halt all bet placement, liquidity changes, and oracle updates.
    function pause() external onlyAuthorized {
        paused = true;
        emit ProtocolPaused(msg.sender);
    }

    /// @notice Resume normal operation.
    function unpause() external onlyAdmin {
        paused = false;
        emit ProtocolUnpaused(msg.sender);
    }

    /// @notice Add an operator (can create markets, propose results, update odds).
    function addOperator(address operator) external onlyAdmin {
        if (operator == address(0)) revert ZeroAddress();
        if (numOperators >= uint8(MAX_OPERATORS)) revert MaxExposureReached();
        _operators[numOperators] = operator;
        unchecked { ++numOperators; }
        emit OperatorAdded(operator);
    }

    /// @notice Remove an operator by address.
    function removeOperator(address operator) external onlyAdmin {
        uint8 n = numOperators;
        for (uint8 i = 0; i < n; ) {
            if (_operators[i] == operator) {
                _operators[i] = _operators[n - 1];
                _operators[n - 1] = address(0);
                unchecked { --numOperators; }
                emit OperatorRemoved(operator);
                return;
            }
            unchecked { ++i; }
        }
        revert Unauthorized();
    }

    /// @notice Return the operator address at index i (for enumeration).
    function getOperator(uint8 i) external view returns (address) {
        require(i < numOperators, "QuadraticMarket: index out of range");
        return _operators[i];
    }

    /// @notice Bulk update protocol risk & timing parameters.
    ///         Pass type(uint256).max to leave a uint256 field unchanged.
    ///         Pass address(type(uint160).max) to leave the oracle address unchanged.
    ///         Pass the desired value — including 0 — to actually update a field.
    function updateConfig(ConfigUpdate calldata u) external onlyAdmin {
        uint256 MAX = type(uint256).max;
        if (u.maxMarketExposure         != MAX) maxMarketExposure         = u.maxMarketExposure;
        if (u.challengeWindowSeconds    != MAX) challengeWindowSeconds    = u.challengeWindowSeconds;
        if (u.settlementDeadlineSeconds != MAX) settlementDeadlineSeconds = u.settlementDeadlineSeconds;
        if (u.slipHouseMarginBps        != MAX) slipHouseMarginBps        = u.slipHouseMarginBps;
        if (u.maxSlipBonusMultiplierBps != MAX) maxSlipBonusMultiplierBps = u.maxSlipBonusMultiplierBps;
        if (u.epochDurationSeconds      != MAX) epochDurationSeconds      = u.epochDurationSeconds;
        if (u.withdrawalCooldownSeconds != MAX) withdrawalCooldownSeconds = u.withdrawalCooldownSeconds;
        if (u.maxSingleBet              != MAX) maxSingleBet              = u.maxSingleBet;
        if (u.buyFeeBps                 != MAX) buyFeeBps                 = u.buyFeeBps;
        if (u.cashOutMarginBps          != MAX) cashOutMarginBps          = u.cashOutMarginBps;
        if (u.crossMatchBonusPerPairBps != MAX) crossMatchBonusPerPairBps = u.crossMatchBonusPerPairBps;
        if (u.oracle != address(type(uint160).max)) oracle                = u.oracle;

        emit ConfigUpdated(msg.sender);
    }

    // ─── Epoch Management ─────────────────────────────────────────────────────

    /// @notice Initialize the on-chain Epoch record for `currentEpoch`.
    ///         Opens the LP deposit window immediately. Deposits close at `epochStartTime`.
    ///         Markets can only be created after `epochStartTime` (when trading begins).
    ///
    /// @param epochStartTime          Unix timestamp when trading opens and deposits close.
    ///                                Must be in the future. Deposit window = [now, epochStartTime].
    /// @param maxExposureMultiplierBps  e.g. 15 000 = 1.5× — LP can lose at most 50% of deposit.
    ///                                  Enforced on every bet: totalLockedPayouts ≤ deposit × multiplier.
    function initEpoch(
        uint256 epochStartTime,
        uint256 maxExposureMultiplierBps
    ) external onlyAuthorized {
        uint64 eid = currentEpoch;
        Epoch storage ep = epochs[eid];

        // Use the `initialized` flag — fixes epoch-0 bug where epochId==0 was ambiguous
        if (ep.initialized) revert EpochAlreadyInitialized();
        if (epochStartTime <= block.timestamp) revert InvalidAmount(); // must be future

        uint256 endTime = epochStartTime + epochDurationSeconds;

        ep.epochId                  = eid;
        ep.startTime                = epochStartTime;
        ep.endTime                  = endTime;
        ep.initialized              = true;
        ep.allMarketsSettled        = true;   // true until first market is added
        ep.withdrawalsEnabled       = false;  // enabled after all markets settle
        ep.lpSharesAtClose          = 0;
        ep.totalLiquidityAdded      = 0;
        ep.totalLiquidityRemoved    = 0;
        ep.numMarkets               = 0;
        ep.numSettledMarkets        = 0;
        ep.totalLockedPayouts       = 0;
        ep.maxExposureMultiplierBps = maxExposureMultiplierBps > 0
            ? maxExposureMultiplierBps
            : 15_000;
        ep.winningSportCategory     = 0;

        nextEpochStart = endTime;

        emit EpochInitialized(eid, epochStartTime, endTime);
        emit EpochDepositsGated(eid, epochStartTime);
    }

    /// @notice Advance to the next epoch once all current-epoch markets are settled.
    ///         Flips `withdrawalsEnabled` on the completed epoch so LPs can exit.
    ///         Caller must then call initEpoch() to open the new epoch for deposits.
    function advanceEpoch() external onlyAuthorized {
        Epoch storage ep = epochs[currentEpoch];

        // Bug 2 fix: use semantically correct error for uninitialized epoch
        if (!ep.initialized) revert EpochNotInitialized();

        // Every market in the epoch must be settled (voided markets count as settled)
        if (ep.numMarkets > 0 && ep.numSettledMarkets < ep.numMarkets) {
            revert EpochNotSettled();
        }

        ep.allMarketsSettled  = true;
        ep.withdrawalsEnabled = true;
        ep.lpSharesAtClose    = totalLpShares;

        // Bug 3 fix: record that at least one epoch has settled — gates requestWithdraw
        anyEpochSettled = true;

        uint64 prev = currentEpoch;
        unchecked { ++currentEpoch; }
        epochPaused = false;

        emit EpochAdvanced(prev, currentEpoch);
    }

    // ─── Phase 2 — LP Vault ───────────────────────────────────────────────────
    //
    // Epoch lifecycle for LPs:
    //   1. Admin calls initEpoch(epochStartTime, multiplierBps)
    //   2. LPs call addLiquidity() — only accepted while block.timestamp < epoch.startTime
    //   3. LPs optionally call voteCategory() to influence which sport gets markets
    //   4. Admin creates markets once epoch.startTime passes
    //   5. Bettors place bets; exposure cap enforced per bet
    //   6. epoch.endTime passes → oracle settles markets → advanceEpoch()
    //   7. LPs call requestWithdraw() → wait cooldown → processWithdrawal()
    //
    // NAV formula (ERC4626-style):
    //   shares_out = amount × totalLpShares / treasuryBalance   (pro-rata)
    //   amount_out = shares  × treasuryBalance / totalLpShares  (on withdrawal)
    //   First deposit: shares = amount − MIN_FIRST_LIQUIDITY (inflation-attack guard)

    /// @notice Deposit USDC into the LP vault for the current epoch.
    ///         Only callable during the deposit window (before epoch.startTime).
    ///         Mints LP shares at current NAV. Shares represent a pro-rata claim on
    ///         the treasury after all epoch markets are settled.
    ///
    /// @param amount  USDC amount to deposit (in base-token units, 6 decimals).
    function addLiquidity(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();

        Epoch storage ep = epochs[currentEpoch];
        if (!ep.initialized) revert EpochNotInitialized();

        // Deposit window: only before epoch starts (trading begins at startTime)
        if (block.timestamp >= ep.startTime) revert EpochLiquidityGated();

        // Bug 1 fix: virtual-offset formula (mirrors OZ ERC4626 v5).
        //   shares = amount × (totalSupply + 1) / (vaultBalance + 1)
        //
        // Why this defeats the inflation attack:
        //   A post-deposit donation increases `bal` by D, but the denominator grows
        //   proportionally, so the second depositor's shares only fall by ~D/bal —
        //   a rounding loss of 1, not a total wipe. No special first-deposit branch
        //   is needed; the formula handles the empty-vault case naturally
        //   (result ≈ amount when both supply and balance are zero → both +1 cancel).
        //
        // Balance MUST be sampled BEFORE safeTransferFrom so the incoming tokens
        // do not inflate the denominator for this very deposit.
        uint256 bal    = baseToken.balanceOf(address(this));
        uint256 shares = (amount * (totalLpShares + 1)) / (bal + 1);
        if (shares == 0) revert InvalidAmount();

        // Pull USDC from LP → treasury (this contract)
        baseToken.safeTransferFrom(msg.sender, address(this), amount);

        // Credit shares
        lpShares[msg.sender]                          += shares;
        totalLpShares                                 += shares;
        lpDepositsPerEpoch[msg.sender][currentEpoch]  += amount;
        ep.totalLiquidityAdded                        += amount;

        emit LiquidityAdded(msg.sender, amount, shares, currentEpoch);
    }

    /// @notice Queue an LP withdrawal for `shares` of the LP vault.
    ///         Only callable after the epoch has ended AND all markets are settled
    ///         (withdrawalsEnabled == true), which is set by advanceEpoch().
    ///         A cooldown period (withdrawalCooldownSeconds) must then pass before
    ///         processWithdrawal() can execute the actual transfer.
    ///
    /// @param shares  Number of LP shares to redeem.
    function requestWithdraw(uint256 shares) external whenNotPaused {
        if (shares == 0) revert InvalidAmount();
        if (lpShares[msg.sender] < shares) revert InsufficientLiquidity();
        if (withdrawalRequests[msg.sender].exists) revert WithdrawalCooldownActive();

        // Bug 3 fix: LP shares are fungible across epochs.
        // The only meaningful gate is that at least one epoch has fully settled,
        // confirming the protocol has run at least one complete cycle.
        // `anyEpochSettled` is set by advanceEpoch() and is never unset.
        // Free-liquidity sufficiency is checked at processWithdrawal() time,
        // not here — locking it here would create a race condition with bettors.
        if (!anyEpochSettled) revert EpochNotSettled();

        withdrawalRequests[msg.sender] = WithdrawalRequest({
            shares:      shares,
            requestedAt: block.timestamp,
            snapshotNav: lpNav(),   // Bug 5: snapshot NAV now for floor protection
            epochId:     currentEpoch,
            exists:      true
        });

        emit WithdrawalRequested(msg.sender, shares, currentEpoch);
    }

    /// @notice Execute a queued withdrawal after the cooldown period.
    ///         Redeems LP shares at current NAV and transfers USDC to caller.
    ///         Will revert if free liquidity is insufficient (outstanding payouts
    ///         are still locked — LP must wait for bettors to claim or markets to void).
    function processWithdrawal() external nonReentrant whenNotPaused {
        WithdrawalRequest storage req = withdrawalRequests[msg.sender];
        if (!req.exists) revert NoPendingWithdrawal();

        // Cooldown guard
        if (block.timestamp < req.requestedAt + withdrawalCooldownSeconds) {
            revert WithdrawalCooldownActive();
        }

        uint256 shares = req.shares;
        if (lpShares[msg.sender] < shares) revert InsufficientLiquidity();

        // Bug 5 fix: NAV floor protection.
        // Use min(snapshotNav, currentNav) so a large winning bet during the cooldown
        // window does not silently reduce the LP's payout below their expectation at
        // request time. The LP always receives the worse of the two NAVs — they bear
        // post-request losses but cannot harvest post-request gains (prevents gaming).
        uint256 currentNav  = lpNav(); // × ODDS_PRECISION
        uint256 navToUse    = currentNav < req.snapshotNav ? currentNav : req.snapshotNav;
        uint256 amount      = (shares * navToUse) / ODDS_PRECISION;
        if (amount == 0) revert InvalidAmount();

        // Can only pay out free liquidity (locked payouts must stay in treasury)
        if (amount > freeLiquidity()) revert InsufficientLiquidity();

        // Burn shares
        lpShares[msg.sender] -= shares;
        totalLpShares        -= shares;

        epochs[req.epochId].totalLiquidityRemoved += amount;

        delete withdrawalRequests[msg.sender];

        baseToken.safeTransfer(msg.sender, amount);

        emit WithdrawalProcessed(msg.sender, amount, shares);
    }

    // ─── LP Category Voting ────────────────────────────────────────────────────

    /// @notice Vote on which sport category should have markets in the next epoch.
    ///         Vote weight = caller's current LP share balance.
    ///         One vote per LP per epoch; changing vote not supported (vote early).
    ///         Admin reads the winning category off-chain and creates markets accordingly.
    ///         This keeps governance lightweight — LPs signal preference, admin executes.
    ///
    /// @param category  The SportCategory to vote for.
    function voteCategory(SportCategory category) external whenNotPaused {
        if (lpShares[msg.sender] == 0) revert InsufficientLiquidity();

        uint64 eid     = currentEpoch;
        uint8  catKey  = uint8(category);

        // Prevent double-voting (stored as catKey + 1 so 0 = no vote)
        if (lpCategoryVote[msg.sender][eid] != 0) revert InvalidAmount();

        uint256 weight = lpShares[msg.sender];
        lpCategoryVote[msg.sender][eid]  = catKey + 1;
        epochCategoryVotes[eid][catKey] += weight;

        // Update winning category (highest vote-weight wins; ties go to lower enum value)
        uint8 winner = epochs[eid].winningSportCategory;
        if (epochCategoryVotes[eid][catKey] > epochCategoryVotes[eid][winner]) {
            epochs[eid].winningSportCategory = catKey;
        }

        emit CategoryVoted(msg.sender, eid, category, weight);
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    /// @dev Returns true if `caller` is the admin or a registered operator.
    function _isAuthorized(address caller) internal view returns (bool) {
        if (caller == admin) return true;
        uint8 n = numOperators;
        for (uint8 i = 0; i < n; ) {
            if (_operators[i] == caller) return true;
            unchecked { ++i; }
        }
        return false;
    }

    /// @dev Increment and return the next market ID.
    function _nextMarketId() internal returns (uint64 id) {
        id = nextMarketId;
        unchecked { ++nextMarketId; }
    }

    /// @dev Increment and return the next group ID.
    function _nextGroupId() internal returns (uint64 id) {
        id = nextGroupId;
        unchecked { ++nextGroupId; }
    }

    /// @dev Increment and return the next slip ID.
    function _nextSlipId() internal returns (uint64 id) {
        id = nextSlipId;
        unchecked { ++nextSlipId; }
    }

    /// @dev Increment and return the next order ID.
    function _nextOrderId() internal returns (uint64 id) {
        id = nextOrderId;
        unchecked { ++nextOrderId; }
    }

    /// @dev Revert if market is not tradable.
    function _requireOpen(uint64 marketId) internal view {
        if (markets[marketId].status != MarketStatus.Open) revert MarketNotOpen();
    }

    /// @dev Revert if market has already started (no new bets).
    function _requireNotStarted(uint64 marketId) internal view {
        if (block.timestamp >= markets[marketId].startTime) revert MarketAlreadyStarted();
    }

    // ─── Exposure cap enforcement (called by Phase 3 bet functions) ──────────

    /// @dev Reverts if adding `newPayout` to an epoch's locked payouts would breach
    ///      the LP exposure cap: totalLockedPayouts ≤ epochDeposit × multiplier.
    ///      Called inside buyAtOdds and placeSlip before accepting any bet.
    function _checkEpochExposure(uint64 epochId, uint256 newPayout) internal view {
        Epoch storage ep = epochs[epochId];
        uint256 maxExposure = LibOdds.maxEpochExposure(
            ep.totalLiquidityAdded,
            ep.maxExposureMultiplierBps
        );
        // maxExposure == 0 when no LP has deposited — reject all bets
        if (maxExposure == 0) revert InsufficientLiquidity();
        if (ep.totalLockedPayouts + newPayout > maxExposure) revert VolumeCapExceeded();
    }

    /// @dev Increment epoch's locked payout counter and the global counter.
    ///      Called after _checkEpochExposure passes.
    function _lockPayout(uint64 epochId, uint256 payout) internal {
        epochs[epochId].totalLockedPayouts += payout;
        totalLockedPayouts                 += payout;
    }

    /// @dev Decrement epoch's locked payout counter and the global counter.
    ///      Called when a bet is claimed, market voided, or cash-out processed.
    function _unlockPayout(uint64 epochId, uint256 payout) internal {
        uint256 ep = epochs[epochId].totalLockedPayouts;
        epochs[epochId].totalLockedPayouts = ep > payout ? ep - payout : 0;
        totalLockedPayouts = totalLockedPayouts > payout ? totalLockedPayouts - payout : 0;
    }

    // ─── View helpers ─────────────────────────────────────────────────────────

    /// @notice Current USDC balance held by this contract (treasury).
    function treasuryBalance() external view returns (uint256) {
        return baseToken.balanceOf(address(this));
    }

    /// @notice Free liquidity = treasury balance minus all outstanding payout obligations.
    function freeLiquidity() public view returns (uint256) {
        uint256 bal    = baseToken.balanceOf(address(this));
        uint256 locked = totalLockedPayouts + orderCollateralLocked;
        return bal > locked ? bal - locked : 0;
    }

    /// @notice Current LP share NAV: USDC value per share (scaled by ODDS_PRECISION).
    ///         e.g. 1_050_000 = 1.05 USDC per share (5% gain since deposit).
    function lpNav() public view returns (uint256) {
        if (totalLpShares == 0) return ODDS_PRECISION; // 1.0 initial NAV
        return (baseToken.balanceOf(address(this)) * ODDS_PRECISION) / totalLpShares;
    }

    /// @notice USDC value of an LP's entire share balance at current NAV.
    function lpValue(address lp) external view returns (uint256) {
        if (totalLpShares == 0) return 0;
        return (lpShares[lp] * baseToken.balanceOf(address(this))) / totalLpShares;
    }

    /// @notice Maximum total payout obligation allowed for an epoch given current deposits.
    ///         Bets are rejected once this ceiling is reached.
    function epochMaxExposure(uint64 epochId) external view returns (uint256) {
        Epoch storage ep = epochs[epochId];
        return LibOdds.maxEpochExposure(ep.totalLiquidityAdded, ep.maxExposureMultiplierBps);
    }

    /// @notice Remaining payout capacity an epoch can still accept.
    function epochRemainingCapacity(uint64 epochId) external view returns (uint256) {
        Epoch storage ep = epochs[epochId];
        uint256 max = LibOdds.maxEpochExposure(ep.totalLiquidityAdded, ep.maxExposureMultiplierBps);
        return max > ep.totalLockedPayouts ? max - ep.totalLockedPayouts : 0;
    }

    /// @notice The sport category with the most LP vote-weight for an epoch.
    function epochWinningCategory(uint64 epochId) external view returns (SportCategory, uint256 voteWeight) {
        uint8 winner = epochs[epochId].winningSportCategory;
        return (SportCategory(winner), epochCategoryVotes[epochId][winner]);
    }

    /// @notice Category vote totals for all categories in a given epoch.
    function epochCategoryBreakdown(uint64 epochId)
        external
        view
        returns (uint256[6] memory votes)
    {
        for (uint8 i = 0; i < NUM_SPORT_CATEGORIES; ) {
            votes[i] = epochCategoryVotes[epochId][i];
            unchecked { ++i; }
        }
    }

    /// @notice Whether an address is admin or operator.
    function isAuthorized(address account) external view returns (bool) {
        return _isAuthorized(account);
    }

    // ─── Phase 3 — Market Creation, Oracle Odds, Single Bets ─────────────────
    //
    // Pre-epoch window timeline (from user spec):
    //   1. Admin calls initEpoch(epochStartTime, multiplierBps)
    //   2. Admin calls createMarketGroup + createMarket → status = PreOpen
    //      LPs can now see the full card of events before depositing capital
    //   3. LPs call addLiquidity / voteCategory
    //   4. epochStartTime passes → admin calls bulkOpenMarkets → status = Open
    //   5. Bettors call buyAtOdds (with minOdds slippage guard)
    //   6. Oracle calls updateOdds (signed) as lines move pre-match
    //   7. market.startTime passes → AwaitingResult, oracle settles
    //   8. voidIfExpired is permissionless safety net if oracle goes silent

    // ─── Market Group ─────────────────────────────────────────────────────────

    /// @notice Create a new MarketGroup (the real-world event / match).
    ///         All markets within a group share a same-match parlay correlation discount.
    ///         Call this during the pre-epoch deposit window so LPs see the full card.
    ///
    /// @param title            e.g. "Arsenal vs Chelsea — Jun 14 2026"
    /// @param eventStartTime   Informational — when the event kicks off
    /// @param maxGroupExposure LP-backed payout cap for this event (0 = maxMarketExposure)
    function createMarketGroup(
        string   calldata title,
        uint256  eventStartTime,
        uint256  maxGroupExposure
    ) external onlyAuthorized returns (uint64 groupId) {
        if (!epochs[currentEpoch].initialized) revert EpochNotInitialized();

        groupId = _nextGroupId();

        MarketGroup storage mg = marketGroups[groupId];
        mg.groupId          = groupId;
        mg.creator          = msg.sender;
        mg.title            = title;
        mg.eventStartTime   = eventStartTime;
        mg.maxGroupExposure = maxGroupExposure > 0 ? maxGroupExposure : maxMarketExposure;
        mg.numMarkets       = 0;
        mg.exists           = true;

        emit MarketGroupCreated(groupId, title, eventStartTime);
    }

    /// @notice Create an individual betting market (PreOpen) inside a MarketGroup.
    ///         Status is PreOpen until openMarket() is called once the epoch starts.
    ///
    ///         The oddsAnchor array must carry a valid oracle ECDSA signature proving
    ///         the prices come from an external source (Pinnacle / The Odds API).
    ///         The anchor is immutable after creation — updateOdds cannot drift beyond
    ///         `maxDeviationBps` from it, so LPs know the worst-case price swing.
    function createMarket(CreateMarketParams calldata p) external onlyAuthorized returns (uint64 marketId) {
        Epoch storage ep = epochs[currentEpoch];
        if (!ep.initialized)                                   revert EpochNotInitialized();
        if (p.numOutcomes < 2 || p.numOutcomes > MAX_OUTCOMES) revert InvalidNumOutcomes();
        if (p.startTime <= block.timestamp)                    revert InvalidAmount();

        // Verify oracle signed the odds anchor
        _verifyCreateMarketSig(p);

        marketId = _nextMarketId();
        Market storage m = markets[marketId];

        m.marketId        = marketId;
        m.creator         = msg.sender;
        m.startTime       = p.startTime;
        m.status          = MarketStatus.PreOpen;
        m.numOutcomes     = p.numOutcomes;
        m.marketType      = p.marketType;
        m.category        = p.category;
        m.title           = p.title;
        m.description     = p.description;
        m.epochId         = currentEpoch;
        m.groupId         = p.groupId;
        m.hasGroup        = p.groupId != 0;
        m.maxDeviationBps = p.maxDeviationBps > 0 ? p.maxDeviationBps : 1_000; // 10% default

        uint256 autoVol = _autoVolumeCap(ep, p.numOutcomes);
        for (uint8 i = 0; i < p.numOutcomes; ) {
            if (p.oddsAnchor[i] < LibOdds.MIN_ODDS) revert OddsBelowMinimum();
            m.oddsAnchor[i]   = p.oddsAnchor[i];
            m.currentOdds[i]  = p.oddsAnchor[i];
            m.volumeCap[i]    = p.volumeCap[i] > 0 ? p.volumeCap[i] : autoVol;
            unchecked { ++i; }
        }
        m.oddsLastUpdated = block.timestamp;

        // Register in group
        if (m.hasGroup) {
            MarketGroup storage mg = marketGroups[p.groupId];
            if (!mg.exists)                     revert GroupNotFound();
            if (mg.numMarkets >= MAX_GROUP_MKTS) revert GroupFull();
            m.groupMarketIndex          = mg.numMarkets;
            mg.marketIds[mg.numMarkets] = marketId;
            unchecked { ++mg.numMarkets; }
            emit MarketAddedToGroup(p.groupId, marketId, m.groupMarketIndex);
        }

        // Register in epoch — flip allMarketsSettled to false (epoch now has live markets)
        unchecked { ++ep.numMarkets; }
        ep.allMarketsSettled = false;

        emit MarketCreated(marketId, p.groupId, p.marketType, p.title, p.startTime);
    }

    /// @notice Flip a single PreOpen market to Open.
    ///         Requires epoch.startTime to have passed — ensures LPs had the full
    ///         deposit window to see the market before it accepts bets.
    function openMarket(uint64 marketId) public onlyAuthorized {
        Market storage m = markets[marketId];
        if (m.marketId == 0 || m.status != MarketStatus.PreOpen) revert InvalidMarketStatus();

        Epoch storage ep = epochs[m.epochId];
        if (!ep.initialized)              revert EpochNotInitialized();
        if (block.timestamp < ep.startTime) revert EpochLiquidityGated();

        m.status = MarketStatus.Open;
        emit MarketStatusChanged(marketId, MarketStatus.Open);
    }

    /// @notice Batch-open multiple PreOpen markets in one transaction.
    ///         Silently skips any market that is not PreOpen or whose epoch hasn't started.
    function bulkOpenMarkets(uint64[] calldata marketIds) external onlyAuthorized {
        uint256 len = marketIds.length;
        for (uint256 i = 0; i < len; ) {
            uint64 mid = marketIds[i];
            Market storage m = markets[mid];
            if (m.marketId != 0 && m.status == MarketStatus.PreOpen) {
                Epoch storage ep = epochs[m.epochId];
                if (ep.initialized && block.timestamp >= ep.startTime) {
                    m.status = MarketStatus.Open;
                    emit MarketStatusChanged(mid, MarketStatus.Open);
                }
            }
            unchecked { ++i; }
        }
    }

    /// @notice Suspend betting on a market (live incident, lineup news, etc.).
    function suspendMarket(uint64 marketId) external onlyAuthorized {
        Market storage m = markets[marketId];
        if (m.status != MarketStatus.Open) revert InvalidMarketStatus();
        m.status = MarketStatus.Suspended;
        emit MarketStatusChanged(marketId, MarketStatus.Suspended);
    }

    /// @notice Reopen a suspended market.
    function resumeMarket(uint64 marketId) external onlyAuthorized {
        Market storage m = markets[marketId];
        if (m.status != MarketStatus.Suspended) revert InvalidMarketStatus();
        m.status = MarketStatus.Open;
        emit MarketStatusChanged(marketId, MarketStatus.Open);
    }

    // ─── Oracle Odds Updates ──────────────────────────────────────────────────

    /// @notice Update market odds via oracle-signed payload.
    ///         Only callable before market.startTime (match kick-off).
    ///         Each new odds value is validated against the creation-time anchor
    ///         via LibOdds.withinDeviation — the oracle cannot shade lines beyond
    ///         `maxDeviationBps` from the anchor, protecting LP from mispricing.
    ///
    /// @param marketId    Target market
    /// @param newOdds     Replacement odds for each outcome (× ODDS_PRECISION); unused
    ///                    slots (beyond numOutcomes) are ignored
    /// @param sigDeadline Oracle sig expires at this timestamp (prevents replay)
    /// @param sig         Oracle ECDSA signature
    function updateOdds(
        uint64                       marketId,
        uint256[MAX_OUTCOMES] calldata newOdds,
        uint256                      sigDeadline,
        bytes calldata               sig
    ) external onlyAuthorized {
        if (block.timestamp > sigDeadline) revert ChallengeWindowExpired();

        Market storage m = markets[marketId];
        if (m.marketId == 0) revert InvalidMarketStatus();
        if (m.status != MarketStatus.Open && m.status != MarketStatus.PreOpen) {
            revert InvalidMarketStatus();
        }
        if (block.timestamp >= m.startTime) revert MarketAlreadyStarted();

        // Verify oracle ECDSA signature covers (prefix, chainId, contract, marketId, odds, deadline)
        bytes32 msgHash = keccak256(abi.encodePacked(
            "QM:updateOdds",
            block.chainid,
            address(this),
            marketId,
            newOdds,
            sigDeadline
        ));
        address signer = ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(msgHash), sig);
        if (signer != oracle) revert InvalidOracleSignature();

        // Apply per-outcome — validate deviation from anchor before writing
        for (uint8 i = 0; i < m.numOutcomes; ) {
            if (newOdds[i] < LibOdds.MIN_ODDS) revert OddsBelowMinimum();
            if (!LibOdds.withinDeviation(newOdds[i], m.oddsAnchor[i], m.maxDeviationBps)) {
                revert OddsDeviationExceeded();
            }
            m.currentOdds[i] = newOdds[i];
            unchecked { ++i; }
        }
        m.oddsLastUpdated = block.timestamp;

        emit OddsUpdated(marketId, newOdds, block.timestamp);
    }

    // ─── Single-Outcome Bet ───────────────────────────────────────────────────

    /// @notice Place a single-outcome bet at current oracle odds.
    ///         The `minOdds` parameter is mandatory — it protects the bettor from
    ///         front-running: if the oracle updates odds between the bettor signing
    ///         the tx and it landing on-chain, the bet is rejected rather than filled
    ///         at a worse price.
    ///
    /// @param marketId   Target market
    /// @param outcomeId  Outcome index to back (0-indexed)
    /// @param stake      USDC to stake (in base-token units, 6 decimals)
    /// @param minOdds    Minimum acceptable odds (× ODDS_PRECISION) — tx reverts if
    ///                   current odds are below this
    function buyAtOdds(
        uint64  marketId,
        uint8   outcomeId,
        uint256 stake,
        uint256 minOdds
    ) external nonReentrant whenNotPaused {
        if (epochPaused)                        revert ProtocolIsPaused();
        if (stake == 0 || stake > maxSingleBet) revert InvalidAmount();

        Market storage m = markets[marketId];
        _requireOpen(marketId);
        _requireNotStarted(marketId);

        if (outcomeId >= m.numOutcomes) revert InvalidOutcomeId();

        uint256 odds = m.currentOdds[outcomeId];

        // Slippage guard — non-negotiable (Claude2.md front-running scenario)
        if (odds < minOdds) revert OddsSlippageExceeded();

        // Deduct buy fee from stake before computing payout
        uint256 effectiveStake = buyFeeBps > 0
            ? (stake * (BPS - buyFeeBps)) / BPS
            : stake;

        uint256 payout = LibOdds.computePayout(effectiveStake, odds);

        // Per-outcome volume cap (limits single-outcome LP liability)
        if (!LibOdds.withinVolumeCap(m.volumeFilled[outcomeId], m.volumeCap[outcomeId], payout)) {
            revert VolumeCapExceeded();
        }

        // Epoch-level exposure cap (total locked payouts ≤ LP deposit × multiplier)
        _checkEpochExposure(m.epochId, payout);

        // ── All checks passed — execute ────────────────────────────────────────
        baseToken.safeTransferFrom(msg.sender, address(this), stake);

        // Outcome shares: redeemable 1:1 in payout units if outcome wins
        outcomeBalances[msg.sender][marketId][outcomeId] += payout;
        // Stake record: used for exact refunds if market is voided
        outcomeStakes[msg.sender][marketId][outcomeId]   += stake;

        // Market + epoch accounting
        m.volumeFilled[outcomeId] += payout;
        m.lockedPayout            += payout;
        m.backing                 += stake;
        _lockPayout(m.epochId, payout);

        emit BetPlaced(marketId, msg.sender, outcomeId, stake, odds, payout);
    }

    // ─── Permissionless Safety Net ────────────────────────────────────────────

    /// @notice Void a market if the oracle has not settled it within
    ///         `settlementDeadlineSeconds` after market.startTime.
    ///         Permissionless — any address can call this.
    ///         On void: all stakes are refundable via claimVoidRefund (Phase 4),
    ///         and the locked payouts are released back to free LP liquidity.
    function voidIfExpired(uint64 marketId) external {
        Market storage m = markets[marketId];
        if (m.marketId == 0)                      revert InvalidMarketStatus();
        if (m.status == MarketStatus.Settled)      revert MarketAlreadySettled();
        if (m.status == MarketStatus.Voided)       revert MarketAlreadySettled();

        // Must be past the settlement deadline
        if (block.timestamp < m.startTime + settlementDeadlineSeconds) {
            revert SettlementDeadlineNotPassed();
        }

        // Only live/suspended/awaiting markets can be expired
        if (m.status == MarketStatus.Settled || m.status == MarketStatus.Voided) {
            revert MarketAlreadySettled();
        }

        m.status = MarketStatus.Voided;

        // Release locked payouts back to free liquidity
        _unlockPayout(m.epochId, m.lockedPayout);
        m.lockedPayout = 0;

        // Advance epoch settlement counter
        Epoch storage ep = epochs[m.epochId];
        unchecked { ++ep.numSettledMarkets; }
        if (ep.numSettledMarkets >= ep.numMarkets) {
            ep.allMarketsSettled = true;
        }

        emit MarketStatusChanged(marketId, MarketStatus.Voided);
    }

    // ─── Phase 3 internal helpers ─────────────────────────────────────────────

    /// @dev Verify oracle ECDSA signature for createMarket's oddsAnchor.
    ///      Signature covers: prefix, chainId, contract, epochId, groupId,
    ///      numOutcomes, all oddsAnchor values, sigDeadline.
    ///      Reverts with InvalidOracleSignature if signer ≠ oracle.
    ///      Reverts with ChallengeWindowExpired if sigDeadline has passed.
    function _verifyCreateMarketSig(CreateMarketParams calldata p) internal view {
        if (block.timestamp > p.sigDeadline) revert ChallengeWindowExpired();

        bytes32 msgHash = keccak256(abi.encodePacked(
            "QM:createMarket",
            block.chainid,
            address(this),
            currentEpoch,
            p.groupId,
            p.numOutcomes,
            p.oddsAnchor,
            p.sigDeadline
        ));
        address signer = ECDSA.recover(
            MessageHashUtils.toEthSignedMessageHash(msgHash),
            p.oracleSig
        );
        if (signer != oracle) revert InvalidOracleSignature();
    }

    /// @dev Compute a per-outcome volume cap from the epoch's LP pool when the
    ///      admin does not specify one explicitly (volumeCap[i] == 0).
    ///      auto = epochMaxExposure / numOutcomes
    ///      If no LP has deposited yet, returns maxMarketExposure / numOutcomes
    ///      as a conservative fallback.
    function _autoVolumeCap(Epoch storage ep, uint8 numOutcomes) internal view returns (uint256) {
        uint256 epochMax = LibOdds.maxEpochExposure(ep.totalLiquidityAdded, ep.maxExposureMultiplierBps);
        if (epochMax == 0) epochMax = maxMarketExposure;
        return epochMax / numOutcomes;
    }

    // ─── Phase 4 — Settlement Pipeline, Claims, Void Refunds ─────────────────
    //
    // Settlement flow:
    //   1. market.startTime passes → no new bets (enforced in buyAtOdds)
    //   2. Oracle calls proposeResult(marketId, winningOutcome, deadline, sig)
    //      → status: Proposed, Dispute record created with challengeDeadline
    //   3a. If oracle is wrong → admin calls adminOverride(correctedOutcome)
    //       → immediately finalizes with corrected outcome
    //   3b. Challenge window passes → anyone calls finalizeResult(marketId)
    //       → status: Settled, non-winning payouts unlocked back to LP
    //   4. Winners call claimPayout(marketId) — receives outcomeBalance USDC
    //   5. If market voided → bettors call claimVoidRefund(marketId, outcomeId)
    //      — receives exact outcomeStake USDC back

    // ─── Propose Result ───────────────────────────────────────────────────────

    /// @notice Oracle proposes the winning outcome for a market.
    ///         Opens a challenge window (challengeWindowSeconds) during which the
    ///         admin can override if the oracle result is incorrect.
    ///         After the window, anyone calls finalizeResult() to settle.
    ///
    /// @param marketId       Market to settle
    /// @param winningOutcome Proposed winning outcome index
    /// @param sigDeadline    Signature expiry (prevents stale replays)
    /// @param sig            Oracle ECDSA signature
    function proposeResult(
        uint64 marketId,
        uint8  winningOutcome,
        uint256 sigDeadline,
        bytes calldata sig
    ) external onlyAuthorized {
        if (block.timestamp > sigDeadline) revert ChallengeWindowExpired();

        Market storage m = markets[marketId];
        if (m.marketId == 0) revert InvalidMarketStatus();

        // Market must be past kick-off time
        if (block.timestamp < m.startTime) revert MarketNotOpen();

        // Accept Open, Suspended, or AwaitingResult (operator may have forgotten to close)
        if (m.status != MarketStatus.Open        &&
            m.status != MarketStatus.Suspended   &&
            m.status != MarketStatus.AwaitingResult) {
            revert InvalidMarketStatus();
        }

        if (winningOutcome >= m.numOutcomes) revert InvalidOutcomeId();

        // Verify oracle ECDSA signature
        bytes32 msgHash = keccak256(abi.encodePacked(
            "QM:proposeResult",
            block.chainid,
            address(this),
            marketId,
            winningOutcome,
            sigDeadline
        ));
        address signer = ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(msgHash), sig);
        if (signer != oracle) revert InvalidOracleSignature();

        m.status         = MarketStatus.Proposed;
        m.winningOutcome = winningOutcome;
        m.settlementTime = block.timestamp;

        disputes[marketId] = Dispute({
            marketId:          marketId,
            proposedOutcome:   winningOutcome,
            proposer:          msg.sender,
            createdAt:         block.timestamp,
            challengeDeadline: block.timestamp + challengeWindowSeconds,
            status:            DisputeStatus.Pending
        });

        emit ResultProposed(marketId, winningOutcome, msg.sender);
    }

    // ─── Admin Override ───────────────────────────────────────────────────────

    /// @notice Admin corrects an oracle result within the challenge window.
    ///         Immediately finalizes the market with the corrected outcome —
    ///         does not require waiting for the challenge window to close.
    ///         Only callable while block.timestamp < dispute.challengeDeadline.
    ///
    /// @param marketId         Market to correct
    /// @param correctedOutcome The actual winning outcome
    function adminOverride(uint64 marketId, uint8 correctedOutcome) external onlyAdmin {
        Market storage m = markets[marketId];
        if (m.status != MarketStatus.Proposed) revert InvalidMarketStatus();
        if (correctedOutcome >= m.numOutcomes)  revert InvalidOutcomeId();

        Dispute storage d = disputes[marketId];
        if (block.timestamp > d.challengeDeadline) revert ChallengeWindowExpired();

        m.winningOutcome  = correctedOutcome;
        d.proposedOutcome = correctedOutcome;
        d.status          = DisputeStatus.Overridden;

        emit ResultOverridden(marketId, correctedOutcome, msg.sender);

        // Finalize immediately — no need to wait for the window
        _finalizeMarket(marketId, correctedOutcome);
    }

    // ─── Finalize Result ──────────────────────────────────────────────────────

    /// @notice Finalize a market after the oracle challenge window has passed.
    ///         Permissionless — any address can trigger this.
    ///         Releases non-winning payout obligations back to free LP liquidity.
    ///         Winners can then call claimPayout().
    ///
    /// @param marketId Market whose challenge window has elapsed
    function finalizeResult(uint64 marketId) external {
        Market storage m = markets[marketId];
        if (m.status != MarketStatus.Proposed) revert InvalidMarketStatus();

        Dispute storage d = disputes[marketId];
        if (block.timestamp < d.challengeDeadline) revert ChallengeWindowActive();

        d.status = DisputeStatus.Resolved;
        _finalizeMarket(marketId, m.winningOutcome);
    }

    // ─── Claim Payout ─────────────────────────────────────────────────────────

    /// @notice Winning bettors claim their USDC payout after a market is settled.
    ///         Transfers outcomeBalances[caller][marketId][winningOutcome] USDC.
    ///         Burns the share and decrements the epoch's locked payout counter.
    ///
    /// @param marketId The settled market to claim from
    function claimPayout(uint64 marketId) external nonReentrant whenNotPaused {
        Market storage m = markets[marketId];
        if (m.status != MarketStatus.Settled) revert MarketNotSettled();

        uint8   winner = m.winningOutcome;
        uint256 payout = outcomeBalances[msg.sender][marketId][winner];
        if (payout == 0) revert InvalidAmount();

        // Zero before transfer — prevents double-claim and reentrancy
        outcomeBalances[msg.sender][marketId][winner] = 0;
        outcomeStakes[msg.sender][marketId][winner]   = 0; // cleanup stake record

        // Release this bettor's slice from the epoch-level locked counter
        _unlockPayout(m.epochId, payout);

        baseToken.safeTransfer(msg.sender, payout);

        emit PayoutClaimed(marketId, msg.sender, payout);
    }

    // ─── Void Refunds ─────────────────────────────────────────────────────────

    /// @notice Bettors reclaim their exact stake on a voided market.
    ///         Works for all outcomes (bettor may have backed multiple outcomes).
    ///         The LP's payout obligation was already released by voidIfExpired
    ///         or the void path of the settlement pipeline.
    ///
    /// @param marketId  The voided market
    /// @param outcomeId The outcome the caller backed
    function claimVoidRefund(uint64 marketId, uint8 outcomeId) external nonReentrant whenNotPaused {
        Market storage m = markets[marketId];
        if (m.status != MarketStatus.Voided) revert MarketNotVoidable();

        uint256 stake = outcomeStakes[msg.sender][marketId][outcomeId];
        if (stake == 0) revert InvalidAmount();

        // Clear both records before transfer
        outcomeStakes[msg.sender][marketId][outcomeId]   = 0;
        outcomeBalances[msg.sender][marketId][outcomeId] = 0;

        baseToken.safeTransfer(msg.sender, stake);

        emit PayoutClaimed(marketId, msg.sender, stake);
    }

    // ─── Phase 4 internal helper ──────────────────────────────────────────────

    /// @dev Core settlement logic shared by adminOverride and finalizeResult.
    ///
    ///      Accounting on settlement:
    ///        - Non-winning outcome volumeFilled → unlocked from epoch (LP liability freed)
    ///        - Winning outcome volumeFilled    → stays locked until winners claim (claimPayout)
    ///        - m.lockedPayout reduced to winning-only obligation
    ///        - epoch.numSettledMarkets incremented; allMarketsSettled flipped if complete
    ///
    ///      Why unlock non-winners here, not at claim time?
    ///        LP liquidity is freed as soon as the result is confirmed, not when every
    ///        individual bettor happens to claim. This maximises LP capital efficiency —
    ///        freed liquidity can back the next epoch immediately.
    function _finalizeMarket(uint64 marketId, uint8 winningOutcome) internal {
        Market storage m = markets[marketId];

        // Release every non-winning outcome's locked payout back to free liquidity
        uint256 winLiability = m.volumeFilled[winningOutcome];
        for (uint8 i = 0; i < m.numOutcomes; ) {
            if (i != winningOutcome && m.volumeFilled[i] > 0) {
                _unlockPayout(m.epochId, m.volumeFilled[i]);
            }
            unchecked { ++i; }
        }

        // Only winning payouts stay reserved — released per-bettor in claimPayout()
        m.lockedPayout   = winLiability;
        m.status         = MarketStatus.Settled;
        m.winningOutcome = winningOutcome;

        // Epoch settlement tracking
        Epoch storage ep = epochs[m.epochId];
        unchecked { ++ep.numSettledMarkets; }
        if (ep.numSettledMarkets >= ep.numMarkets) {
            ep.allMarketsSettled = true;
        }

        emit MarketFinalized(marketId, winningOutcome);
        emit MarketStatusChanged(marketId, MarketStatus.Settled);
    }

    // ─── Phase 5 — Multi-Leg Bet Slips (Tokenised) ───────────────────────────
    //
    // A bet slip is a multi-leg accumulator: all legs must win for payout.
    // The slip is a transferable token: slipOwner[slipId] holds the claim right.
    // This enables a P2P secondary marketplace (Phase 6) where bettors can sell
    // slips mid-event — before results are finalised.
    //
    // Odds math (applied at placement, locked):
    //   rawCombined  = product(leg.odds) / ODDS_PRECISION^(n-1)
    //   margined     = rawCombined × (BPS - slipHouseMarginBps) / BPS
    //   discounted   = margined  × discountBps / BPS          (correlation penalty)
    //   bonused      = discounted × (BPS + crossBonusBps) / BPS (cross-match reward)
    //   potentialPayout = totalStake × bonused / ODDS_PRECISION
    //
    // V1 void rule: if ANY leg's market is voided → full stake refund.
    //               "Voided leg = 1× multiplier" upgrade planned for V2.

    // ─── Slip Token Ownership ─────────────────────────────────────────────────

    /// @dev Revert if msg.sender is not the slip owner, single approved address,
    ///      or an operator approved by the current owner.
    function _requireSlipAuth(uint64 slipId) internal view {
        address owner = slipOwner[slipId];
        if (owner == address(0)) revert InvalidMarketStatus(); // slip doesn't exist
        if (msg.sender == owner)                          return;
        if (msg.sender == slipApproved[slipId])           return;
        if (slipOperatorApprovals[owner][msg.sender])     return;
        revert Unauthorized();
    }

    /// @notice Approve a single address to transfer a specific slip.
    ///         Clears on transfer. Caller must be current owner.
    function approveSlip(uint64 slipId, address approved) external {
        if (slipOwner[slipId] != msg.sender) revert Unauthorized();
        slipApproved[slipId] = approved;
        emit SlipApproved(slipId, msg.sender, approved);
    }

    /// @notice Grant or revoke an operator's rights over ALL caller's slips.
    ///         Designed for the Phase 6 marketplace contract to manage listings.
    function setSlipOperator(address operator, bool approved) external {
        slipOperatorApprovals[msg.sender][operator] = approved;
        emit SlipOperatorSet(msg.sender, operator, approved);
    }

    /// @notice Transfer slip ownership. Caller must be owner, approved, or operator.
    ///         Clears the per-slip approval on transfer (standard ERC721 behaviour).
    function transferSlip(uint64 slipId, address to) external {
        _requireSlipAuth(slipId);
        if (to == address(0)) revert InvalidAmount(); // no burning

        // Slip must still be active — claimed/cancelled slips have no value
        SlipStatus s = betSlips[slipId].status;
        if (s != SlipStatus.Active) revert InvalidMarketStatus();

        address from = slipOwner[slipId];
        slipOwner[slipId]    = to;
        slipApproved[slipId] = address(0); // clear single approval
        emit SlipTransferred(slipId, from, to);
    }

    // ─── Place Slip ───────────────────────────────────────────────────────────

    /// @notice Place a multi-leg accumulator bet.
    ///         All legs must be in the same epoch and their markets must be Open
    ///         and not yet started (same pre-start gate as buyAtOdds).
    ///         Returns the newly minted slipId.
    ///
    /// @param p  PlaceSlipParams: legs[], numLegs, totalStake, minCombinedOdds
    function placeSlip(
        PlaceSlipParams calldata p
    ) external nonReentrant whenNotPaused returns (uint64 slipId) {
        if (epochPaused)                          revert ProtocolIsPaused();
        if (p.numLegs < 1 || p.numLegs > MAX_SLIP_LEGS) revert InvalidOutcomeId();
        if (p.totalStake == 0 || p.totalStake > maxSingleBet) revert InvalidAmount();

        // ── Step 1: validate legs, lock odds, gather discount inputs ──────────
        uint256  combinedOdds = ODDS_PRECISION; // running product (1.0 identity)
        uint64   epochId      = 0;

        // Memory arrays for LibGroupDiscount inputs
        uint64[]    memory groupIds   = new uint64[](p.numLegs);
        GroupType[] memory groupTypes = new GroupType[](p.numLegs);
        bool[]      memory hasGroups  = new bool[](p.numLegs);

        BetSlip storage slip = betSlips[nextSlipId + 1]; // pre-allocate (id assigned below)

        for (uint8 i = 0; i < p.numLegs; ) {
            PlaceSlipLeg calldata leg = p.legs[i];
            Market storage m = markets[leg.marketId];

            // Market must exist, be Open, and not yet started
            _requireOpen(leg.marketId);
            _requireNotStarted(leg.marketId);

            if (leg.outcomeId >= m.numOutcomes) revert InvalidOutcomeId();

            // All legs must share the same epoch (V1 constraint)
            if (i == 0) {
                epochId = m.epochId;
            } else if (m.epochId != epochId) {
                revert EpochNotInitialized(); // cross-epoch slip rejected
            }

            uint256 odds = m.currentOdds[leg.outcomeId];
            if (odds < leg.minOdds) revert OddsSlippageExceeded(); // per-leg guard

            // Accumulate combined odds: running × odds / PRECISION
            combinedOdds = (combinedOdds * odds) / ODDS_PRECISION;

            // Store locked leg in storage
            slip.legs[i] = SlipLeg({
                marketId:  leg.marketId,
                outcomeId: leg.outcomeId,
                odds:      odds
            });

            // Gather group data for discount engine
            hasGroups[i]  = (m.groupId != 0);
            groupIds[i]   = m.groupId;
            groupTypes[i] = m.marketType; // GroupType lives on Market, not MarketGroup

            unchecked { ++i; }
        }

        // ── Step 2: apply house margin + correlation discount + cross bonus ────
        uint256 margined = slipHouseMarginBps > 0
            ? (combinedOdds * (BPS - slipHouseMarginBps)) / BPS
            : combinedOdds;

        uint256 discountBps = LibGroupDiscount.computeSlipDiscountBps(
            groupIds, groupTypes, hasGroups, p.numLegs
        );
        uint256 discounted = (margined * discountBps) / BPS;

        uint256 crossBonus = LibGroupDiscount.crossMatchBonusBps(
            groupIds, hasGroups, p.numLegs,
            crossMatchBonusPerPairBps,   // existing storage var
            maxSlipBonusMultiplierBps    // existing storage var (cap)
        );
        uint256 finalOdds = crossBonus > 0
            ? (discounted * (BPS + crossBonus)) / BPS
            : discounted;

        // Final combined-odds slippage guard
        if (finalOdds < p.minCombinedOdds) revert OddsSlippageExceeded();
        if (finalOdds < LibOdds.MIN_ODDS)   revert OddsBelowMinimum();

        // ── Step 3: compute payout and check LP exposure cap ──────────────────
        uint256 potentialPayout = (p.totalStake * finalOdds) / ODDS_PRECISION;
        _checkEpochExposure(epochId, potentialPayout);

        // ── Step 4: execute — transfer stake, mint slip, lock payout ──────────
        baseToken.safeTransferFrom(msg.sender, address(this), p.totalStake);

        unchecked { slipId = ++nextSlipId; }

        // Populate the BetSlip struct (legs already written above via pre-alloc ref)
        slip.slipId          = slipId;
        slip.creator         = msg.sender;
        slip.epochId         = epochId;
        slip.numLegs         = p.numLegs;
        slip.totalStake      = p.totalStake;
        slip.combinedOdds    = finalOdds;
        slip.houseMarginBps  = slipHouseMarginBps;
        slip.discountBps     = discountBps;
        slip.crossBonusBps   = crossBonus;
        slip.potentialPayout = potentialPayout;
        slip.status          = SlipStatus.Active;
        slip.createdAt       = block.timestamp;

        // Mint token — placer is first owner
        slipOwner[slipId]    = msg.sender;
        slipApproved[slipId] = address(0);

        // Lock the potential payout in the epoch pool
        _lockPayout(epochId, potentialPayout);

        emit SlipPlaced(slipId, msg.sender, p.numLegs, p.totalStake, potentialPayout);
    }

    // ─── Slip Settlement View ─────────────────────────────────────────────────

    /// @notice Returns the current settlement status of a slip from on-chain state.
    ///
    /// @return pending  True if at least one leg has not yet reached a terminal status
    /// @return won      True if every leg settled on the bettor's chosen outcome
    /// @return hasVoid  True if at least one leg's market is voided
    /// @return hasLost  True if at least one leg settled on the wrong outcome
    function slipResult(uint64 slipId)
        public
        view
        returns (bool pending, bool won, bool hasVoid, bool hasLost)
    {
        BetSlip storage slip = betSlips[slipId];
        uint8 numLegs = slip.numLegs;
        for (uint8 i = 0; i < numLegs; ) {
            SlipLeg storage leg = slip.legs[i];
            Market  storage m   = markets[leg.marketId];
            if      (m.status == MarketStatus.Voided)  { hasVoid = true; }
            else if (m.status == MarketStatus.Settled)  {
                if (m.winningOutcome != leg.outcomeId) hasLost = true;
            } else { pending = true; }
            unchecked { ++i; }
        }
        won = !pending && !hasVoid && !hasLost;
    }

    // ─── Claim Slip Payout ────────────────────────────────────────────────────

    /// @notice Current slip owner (or their approved / operator) claims the payout
    ///         after all legs win. Payout is sent to the current owner — not the
    ///         original creator — enabling secondary-market settlement.
    ///
    /// @param slipId  The winning slip to claim
    function claimSlipPayout(uint64 slipId) external nonReentrant whenNotPaused {
        _requireSlipAuth(slipId);

        BetSlip storage slip = betSlips[slipId];
        if (slip.status != SlipStatus.Active) revert MarketNotSettled();

        (bool pending, bool won, bool hasVoid, bool hasLost) = slipResult(slipId);

        if (hasLost)  revert InvalidMarketStatus(); // slip lost — nothing to claim
        if (hasVoid)  revert MarketNotVoidable();   // use claimSlipVoidRefund instead
        if (pending)  revert ChallengeWindowActive(); // not all legs settled yet
        if (!won)     revert InvalidMarketStatus();

        uint256 payout = slip.potentialPayout;
        slip.status = SlipStatus.Claimed;

        address owner = slipOwner[slipId];
        slipOwner[slipId]    = address(0); // burn ownership (slip is spent)
        slipApproved[slipId] = address(0);

        // Release LP payout reservation
        _unlockPayout(slip.epochId, payout);

        baseToken.safeTransfer(owner, payout);
        emit SlipClaimed(slipId, owner, payout);
    }

    // ─── Claim Slip Void Refund ───────────────────────────────────────────────

    /// @notice Current slip owner claims a full stake refund if any leg is voided.
    ///         V1 void rule: one void = full refund, slip cancelled.
    ///         Callable by current owner / approved / operator.
    ///
    ///         Note: if the slip is already known to be a loser (hasLost = true),
    ///         this reverts — a losing slip can't be refunded just because a leg
    ///         also happened to be voided.
    ///
    /// @param slipId  The slip with at least one voided leg
    function claimSlipVoidRefund(uint64 slipId) external nonReentrant whenNotPaused {
        _requireSlipAuth(slipId);

        BetSlip storage slip = betSlips[slipId];
        if (slip.status != SlipStatus.Active) revert InvalidMarketStatus();

        (, , bool hasVoid, bool hasLost) = slipResult(slipId);

        if (!hasVoid)  revert MarketNotVoidable();    // no voided leg, nothing to refund
        if (hasLost)   revert InvalidMarketStatus();  // lost slip — no refund

        uint256 stake = slip.totalStake;
        slip.status = SlipStatus.Cancelled;

        address owner = slipOwner[slipId];
        slipOwner[slipId]    = address(0);
        slipApproved[slipId] = address(0);

        // Release the full potential payout reservation from the epoch pool
        _unlockPayout(slip.epochId, slip.potentialPayout);

        baseToken.safeTransfer(owner, stake);
        emit SlipVoidRefund(slipId, owner, stake);
    }

    // ─── Cancel Slip (pre-start only) ─────────────────────────────────────────

    /// @notice Owner can cancel a slip and recover stake only if none of the
    ///         legs' markets have started yet (equivalent to "bet void before kick-off").
    ///         Once ANY market has started, the slip is locked in.
    ///
    /// @param slipId  The active slip to cancel
    function cancelSlip(uint64 slipId) external nonReentrant whenNotPaused {
        _requireSlipAuth(slipId);

        BetSlip storage slip = betSlips[slipId];
        if (slip.status != SlipStatus.Active) revert InvalidMarketStatus();

        // All markets must be pre-start for a cancel to be permitted
        uint8 numLegs = slip.numLegs;
        for (uint8 i = 0; i < numLegs; ) {
            if (block.timestamp >= markets[slip.legs[i].marketId].startTime) {
                revert MarketAlreadyStarted(); // too late — at least one match started
            }
            unchecked { ++i; }
        }

        uint256 stake = slip.totalStake;
        slip.status = SlipStatus.Cancelled;

        address owner = slipOwner[slipId];
        slipOwner[slipId]    = address(0);
        slipApproved[slipId] = address(0);

        _unlockPayout(slip.epochId, slip.potentialPayout);

        baseToken.safeTransfer(owner, stake);
        emit SlipCancelled(slipId, owner);
    }

    // ─── Phase 5 config admin ─────────────────────────────────────────────────
    // Slip params live in the main storage block:
    //   slipHouseMarginBps         — margin per slip leg
    //   crossMatchBonusPerPairBps  — cross-match bonus per independent pair
    //   maxSlipBonusMultiplierBps  — cap on cross-match bonus

    /// @notice Admin: update multi-leg slip odds parameters in one call.
    ///         Uses type(uint256).max as "leave unchanged" sentinel (same as updateConfig).
    function updateSlipConfig(
        uint256 newSlipMarginBps,
        uint256 newCrossBonusPerPairBps,
        uint256 newMaxCrossBonusBps
    ) external onlyAdmin {
        uint256 MAX = type(uint256).max;
        if (newSlipMarginBps        != MAX) slipHouseMarginBps           = newSlipMarginBps;
        if (newCrossBonusPerPairBps != MAX) crossMatchBonusPerPairBps    = newCrossBonusPerPairBps;
        if (newMaxCrossBonusBps     != MAX) maxSlipBonusMultiplierBps    = newMaxCrossBonusBps;
    }
}
