// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./interfaces/ITypes.sol";
import "./libraries/LibOdds.sol";

/// @title QuadraticMarketStorage
/// @notice Abstract base that owns all protocol state, modifiers, and shared
///         internal helpers. Nothing deployable lives here — concrete deployment
///         is done by QuadraticMarket (the leaf of the inheritance chain).
///
/// Inheritance chain (single file per concern):
///   QuadraticMarketStorage  ← all storage + modifiers + helpers
///       ↑
///   QuadraticLP             ← LP vault: deposits, withdrawals, category voting
///       ↑
///   QuadraticSlips          ← multi-leg slip: tokenised, tradeable
///       ↑
///   QuadraticMarket         ← admin + epoch + markets + oracle + settlement (deployed)
abstract contract QuadraticMarketStorage is ReentrancyGuard, IQuadraticMarketEvents, IQuadraticMarketErrors {
    using SafeERC20 for IERC20;

    // ─── Protocol configuration ───────────────────────────────────────────────

    address public admin;
    bool    public paused;

    /// @dev Oracle address that signs updateOdds and proposeResult calls.
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
    bool    public anyEpochSettled;

    // ── Operators ──────────────────────────────────────────────────────────────

    address[MAX_OPERATORS] internal _operators;
    uint8   public numOperators;

    // ─── Storage mappings ─────────────────────────────────────────────────────

    mapping(uint64 => Market)      public markets;
    mapping(uint64 => Epoch)       public epochs;
    mapping(uint64 => BetSlip)     public betSlips;
    mapping(uint64 => MarketGroup) public marketGroups;
    mapping(uint64 => Order)       public orders;
    mapping(uint64 => Dispute)     public disputes;

    // ── LP accounting ──────────────────────────────────────────────────────────

    mapping(address => uint256)                          public lpShares;
    mapping(address => WithdrawalRequest)                public withdrawalRequests;
    mapping(address => PendingLiquidity)                 public pendingLiquidity;
    mapping(address => mapping(uint64 => uint256))       public lpDepositsPerEpoch;

    // ── Bettor positions ───────────────────────────────────────────────────────

    /// @notice Payout shares: bettor → marketId → outcomeId → payout on win.
    mapping(address => mapping(uint64 => mapping(uint8 => uint256))) public outcomeBalances;

    /// @notice Stake record: bettor → marketId → outcomeId → USDC paid (for void refunds).
    mapping(address => mapping(uint64 => mapping(uint8 => uint256))) public outcomeStakes;

    // ── Slip token ownership ───────────────────────────────────────────────────

    /// @notice Current owner of a slip (receives payout / void-refund). Transferable.
    mapping(uint64 => address) public slipOwner;

    /// @notice Single-address per-slip approval (cleared on transfer).
    mapping(uint64 => address) public slipApproved;

    /// @notice Operator approval — owner grants an address rights over ALL their slips.
    mapping(address => mapping(address => bool)) public slipOperatorApprovals;

    // ── LP category governance ─────────────────────────────────────────────────

    mapping(address => mapping(uint64 => uint8))   public lpCategoryVote;
    mapping(uint64 => mapping(uint8 => uint256))   public epochCategoryVotes;

    // ── Misc ───────────────────────────────────────────────────────────────────

    /// @notice USDC locked per open back-order (separate from LP pool).
    uint256 public orderCollateralLocked;

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

    // ─── Internal helpers (shared across LP, Slips, and Market) ──────────────

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
        id = nextMarketId; unchecked { ++nextMarketId; }
    }

    /// @dev Increment and return the next group ID.
    function _nextGroupId() internal returns (uint64 id) {
        id = nextGroupId; unchecked { ++nextGroupId; }
    }

    /// @dev Increment and return the next order ID.
    function _nextOrderId() internal returns (uint64 id) {
        id = nextOrderId; unchecked { ++nextOrderId; }
    }

    /// @dev Revert if market is not in Open status.
    function _requireOpen(uint64 marketId) internal view {
        if (markets[marketId].status != MarketStatus.Open) revert MarketNotOpen();
    }

    /// @dev Revert if market has already started (no new bets post kick-off).
    function _requireNotStarted(uint64 marketId) internal view {
        if (block.timestamp >= markets[marketId].startTime) revert MarketAlreadyStarted();
    }

    // ─── Exposure cap helpers ─────────────────────────────────────────────────

    /// @dev Reverts if adding `newPayout` would breach the epoch LP exposure cap.
    function _checkEpochExposure(uint64 epochId, uint256 newPayout) internal view {
        Epoch storage ep = epochs[epochId];
        uint256 maxExposure = LibOdds.maxEpochExposure(
            ep.totalLiquidityAdded,
            ep.maxExposureMultiplierBps
        );
        if (maxExposure == 0) revert InsufficientLiquidity();
        if (ep.totalLockedPayouts + newPayout > maxExposure) revert VolumeCapExceeded();
    }

    /// @dev Increment both the epoch-level and global locked-payout counters.
    function _lockPayout(uint64 epochId, uint256 payout) internal {
        epochs[epochId].totalLockedPayouts += payout;
        totalLockedPayouts                 += payout;
    }

    /// @dev Decrement both counters (floored at 0 to guard against rounding).
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
    function lpNav() public view returns (uint256) {
        if (totalLpShares == 0) return ODDS_PRECISION;
        return (baseToken.balanceOf(address(this)) * ODDS_PRECISION) / totalLpShares;
    }

    /// @notice USDC value of an LP's entire share balance at current NAV.
    function lpValue(address lp) external view returns (uint256) {
        if (totalLpShares == 0) return 0;
        return (lpShares[lp] * baseToken.balanceOf(address(this))) / totalLpShares;
    }

    /// @notice Maximum total payout obligation allowed for an epoch given deposits.
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
        external view returns (uint256[6] memory votes)
    {
        for (uint8 i = 0; i < NUM_SPORT_CATEGORIES; ) {
            votes[i] = epochCategoryVotes[epochId][i];
            unchecked { ++i; }
        }
    }

    /// @notice Whether an address is admin or an operator.
    function isAuthorized(address account) external view returns (bool) {
        return _isAuthorized(account);
    }
}
