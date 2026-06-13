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
/// Phase 1 — this file covers:
///   ✓ Complete storage layout (all phases)
///   ✓ Initialization
///   ✓ Admin & operator management
///   ✓ Epoch initialization & advancement
///
/// Phases 2–7 add functions without touching storage layout.

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

    // ─── Constants ────────────────────────────────────────────────────────────

    uint256 private constant MIN_FIRST_LIQUIDITY = 1_000; // inflation attack guard

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
    ///         Pass 0 (or zero address) for any field to leave it unchanged.
    function updateConfig(ConfigUpdate calldata u) external onlyAdmin {
        if (u.maxMarketExposure         > 0) maxMarketExposure         = u.maxMarketExposure;
        if (u.challengeWindowSeconds    > 0) challengeWindowSeconds    = u.challengeWindowSeconds;
        if (u.settlementDeadlineSeconds > 0) settlementDeadlineSeconds = u.settlementDeadlineSeconds;
        if (u.slipHouseMarginBps        > 0) slipHouseMarginBps        = u.slipHouseMarginBps;
        if (u.maxSlipBonusMultiplierBps > 0) maxSlipBonusMultiplierBps = u.maxSlipBonusMultiplierBps;
        if (u.epochDurationSeconds      > 0) epochDurationSeconds      = u.epochDurationSeconds;
        if (u.withdrawalCooldownSeconds > 0) withdrawalCooldownSeconds = u.withdrawalCooldownSeconds;
        if (u.maxSingleBet              > 0) maxSingleBet              = u.maxSingleBet;
        if (u.buyFeeBps                 > 0) buyFeeBps                 = u.buyFeeBps;
        if (u.cashOutMarginBps          > 0) cashOutMarginBps          = u.cashOutMarginBps;
        if (u.crossMatchBonusPerPairBps > 0) crossMatchBonusPerPairBps = u.crossMatchBonusPerPairBps;
        if (u.oracle != address(0))          oracle                    = u.oracle;

        emit ConfigUpdated(msg.sender);
    }

    // ─── Epoch Management ─────────────────────────────────────────────────────

    /// @notice Initialize the on-chain Epoch record for `currentEpoch`.
    ///         Must be called by admin/operator before any markets can be created.
    ///         Idempotent: no-op if epoch already initialized.
    /// @param maxExposureMultiplierBps  e.g. 15 000 = 1.5× — LP can lose at most 50% of deposit.
    function initEpoch(uint256 maxExposureMultiplierBps) external onlyAuthorized {
        uint64 eid = currentEpoch;
        Epoch storage ep = epochs[eid];

        if (ep.epochId != 0 && ep.startTime != 0) {
            revert EpochAlreadyInitialized();
        }

        uint256 duration = epochDurationSeconds;
        uint256 epochStart = duration > 0
            ? (block.timestamp / duration) * duration
            : block.timestamp;

        ep.epochId                   = eid;
        ep.startTime                 = epochStart;
        ep.endTime                   = duration > 0 ? epochStart + duration : type(uint256).max;
        ep.totalLiquidityAdded       = 0;
        ep.totalLiquidityRemoved     = 0;
        ep.numMarkets                = 0;
        ep.numSettledMarkets         = 0;
        ep.allMarketsSettled         = true;  // true until first market is created
        ep.withdrawalsEnabled        = true;
        ep.lpSharesAtClose           = totalLpShares;
        ep.maxExposureMultiplierBps  = maxExposureMultiplierBps > 0
            ? maxExposureMultiplierBps
            : 15_000; // default 1.5×
        ep.totalLockedPayouts        = 0;

        if (duration > 0) {
            nextEpochStart = epochStart + duration;
        }

        emit EpochInitialized(eid, ep.startTime, ep.endTime);
    }

    /// @notice Advance to the next epoch.
    ///         Requires all markets in the current epoch to be settled first.
    ///         Caller must then call initEpoch() to open the new epoch.
    function advanceEpoch() external onlyAuthorized {
        Epoch storage ep = epochs[currentEpoch];

        // All markets must be settled (or epoch has zero markets)
        if (!ep.allMarketsSettled && ep.numSettledMarkets < ep.numMarkets) {
            revert EpochNotSettled();
        }

        // Record share count for NAV calculation on withdrawal
        ep.lpSharesAtClose = totalLpShares;
        ep.withdrawalsEnabled = true;

        uint64 prev = currentEpoch;
        unchecked { ++currentEpoch; }

        epochPaused = false;

        emit EpochAdvanced(prev, currentEpoch);
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

    // ─── View helpers ─────────────────────────────────────────────────────────

    /// @notice Current USDC balance held by this contract (treasury).
    function treasuryBalance() external view returns (uint256) {
        return baseToken.balanceOf(address(this));
    }

    /// @notice Free liquidity = treasury balance minus all outstanding payout obligations.
    function freeLiquidity() public view returns (uint256) {
        uint256 bal = baseToken.balanceOf(address(this));
        uint256 locked = totalLockedPayouts + orderCollateralLocked;
        return bal > locked ? bal - locked : 0;
    }

    /// @notice Current LP share NAV in base token units (price per share).
    function lpNav() public view returns (uint256) {
        if (totalLpShares == 0) return ODDS_PRECISION; // 1.0 initial NAV
        return (baseToken.balanceOf(address(this)) * ODDS_PRECISION) / totalLpShares;
    }

    /// @notice Whether an address is admin or operator.
    function isAuthorized(address account) external view returns (bool) {
        return _isAuthorized(account);
    }
}
