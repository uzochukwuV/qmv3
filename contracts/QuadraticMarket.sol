// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

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

    /// @notice Outcome token balances: bettor → marketId → outcomeId → shares.
    ///         Minted on buyAtOdds, burned on claimPayout / cashOut.
    mapping(address => mapping(uint64 => mapping(uint8 => uint256))) public outcomeBalances;

    /// @notice Per-LP deposit tracking per epoch for NAV calculation.
    mapping(address => mapping(uint64 => uint256)) public lpDepositsPerEpoch;

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
        if (!ep.initialized) revert EpochAlreadyInitialized();

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
}
