// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./interfaces/ITypes.sol";
import "./interfaces/IInterContract.sol";
import "./libraries/LibOdds.sol";

/// @title QuadraticCoreStorage
/// @notice Abstract base for QuadraticCore â€” owns all state Core needs.
///
/// State ownership after the V3 split:
///   Core (this):  markets, epochs, orders, disputes, outcomeBalances,
///                 protocol config, token, timing, cross-contract refs
///   Vault:        lpShares, withdrawalRequests, lpDepositsPerEpoch, category votes
///   Slips:        slipOwner, slipApproved, slipOperatorApprovals (reads betSlips from Core)
///
/// Cross-contract references are stored as addresses and set once after deployment.
abstract contract QuadraticCoreStorage is ReentrancyGuard, IQuadraticMarketEvents, IQuadraticMarketErrors {
    using SafeERC20 for IERC20;

    // â”€â”€â”€ Cross-contract references â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Set once at deployment via setters; immutable thereafter.

    address public liquidityVault;
    address public betSlips;
    address public pricingEngine;

    // â”€â”€â”€ Protocol configuration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    address public admin;
    bool    public paused;

    /// @dev Oracle address that signs updateOdds and proposeResult calls.
    address public oracle;

    /// @notice Global max USDC exposure per market (overridable per market).
    uint256 public maxMarketExposure;

    /// @notice Total outstanding payout obligations across all live markets.
    uint256 public totalLockedPayouts;

    /// @notice Cumulative protocol fees collected (buy fees, etc.) for analytics.
    uint256 public totalFeesCollected;

    /// @notice ERC20 base token (USDC or equivalent 6-decimal stablecoin).
    IERC20  public baseToken;

    /// @notice Protocol treasury â€” holds all LP deposits and collected stakes.
    address public treasury;

    // â”€â”€ ID counters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /// @notice Monotonically incrementing market ID counter.
    uint64  public nextMarketId;

    /// @notice Monotonically incrementing market group ID counter.
    uint64  public nextGroupId;

    

    /// @notice Monotonically incrementing order ID counter.
    uint64  public nextOrderId;

    // â”€â”€ Timing parameters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /// @notice Seconds after oracle proposes result during which admin can override.
    uint256 public challengeWindowSeconds;

    /// @notice Seconds after market startTime before oracle must settle (else market voidable).
    uint256 public settlementDeadlineSeconds;

    /// @notice Seconds after LP requests withdrawal before it can be processed.
    uint256 public withdrawalCooldownSeconds;

    // â”€â”€ Fee / risk parameters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    // â”€â”€ Epoch state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    uint64  public currentEpoch;
    uint256 public epochDurationSeconds;
    bool    public epochPaused;
    uint256 public nextEpochStart;

    /// @notice Set to true the first time advanceEpoch() successfully completes.
    bool    public anyEpochSettled;

    /// @notice Most recent epoch that successfully advanced and enabled withdrawals.
    uint64  public lastSettledEpoch;

    /// @notice Global anti-replay nonce consumed by createMarket oracle signatures.
    uint256 public marketCreationNonce;

    // â”€â”€ Operators â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    address[MAX_OPERATORS] internal _operators;
    uint8   public numOperators;

    // â”€â”€â”€ Storage mappings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    mapping(uint64 => Market)       public markets;
    mapping(uint64 => Epoch)        public epochs;    mapping(uint64 => MarketGroup)  public marketGroups;
    mapping(uint64 => Order)        public orders;
    mapping(uint64 => GroupDispute) public groupDisputes;

    // â”€â”€ Bettor positions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /// @notice Payout shares: bettor â†’ marketId â†’ outcomeId â†’ payout on win.
    mapping(address => mapping(uint64 => mapping(uint8 => uint256))) public outcomeBalances;

    /// @notice Stake record: bettor â†’ marketId â†’ outcomeId â†’ USDC paid (for void refunds).
    mapping(address => mapping(uint64 => mapping(uint8 => uint256))) public outcomeStakes;

    // â”€â”€ Misc â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /// @notice USDC locked per open back-order (separate from LP pool).
    uint256 public orderCollateralLocked;

    // â”€â”€â”€ Modifiers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    modifier onlyVault() {
        if (msg.sender != liquidityVault) revert Unauthorized();
        _;
    }

    // â”€â”€â”€ Internal helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    /// @dev Increment and return the next slip ID.

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

    // â”€â”€â”€ Exposure cap helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    /// @dev Revert when LP withdrawals would race an initialized, unsettled current epoch.
    function _requireWithdrawalsOpen() internal view {
        if (!anyEpochSettled) revert EpochNotSettled();
        Epoch storage ep = epochs[currentEpoch];
        if (ep.initialized && !ep.withdrawalsEnabled) revert EpochNotSettled();
    }

    // â”€â”€â”€ View helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    ///         Delegates to LiquidityVault which computes it locally.
    function lpNav() public view returns (uint256) {
        if (liquidityVault == address(0)) return ODDS_PRECISION;
        return ILiquidityVault(liquidityVault).lpNav();
    }

    /// @notice USDC value of an LP's entire share balance at current NAV.
    function lpValue(address lp) external view returns (uint256) {
        if (liquidityVault == address(0)) return 0;
        return ILiquidityVault(liquidityVault).lpValue(lp);
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

    /// @notice Whether an address is admin or an operator.
    function isAuthorized(address account) external view returns (bool) {
        return _isAuthorized(account);
    }

    // â”€â”€â”€ Epoch LP state helpers (called by LiquidityVault) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /// @notice Called by LiquidityVault.onEpochInit to set LP-side epoch state.
    function setEpochLiquidityParams(
        uint64 epochId,
        uint256 totalLiquidityAdded,
        uint256 maxExposureMultiplierBps
    ) external onlyVault {
        Epoch storage ep = epochs[epochId];
        ep.totalLiquidityAdded       = totalLiquidityAdded;
        ep.maxExposureMultiplierBps  = maxExposureMultiplierBps > 0 ? maxExposureMultiplierBps : 15_000;
    }

    /// @notice Called by LiquidityVault.onAdvanceEpoch to record LP withdrawal amount.
    function addEpochLiquidityRemoved(uint64 epochId, uint256 amount) external onlyVault {
        epochs[epochId].totalLiquidityRemoved += amount;
    }
}
