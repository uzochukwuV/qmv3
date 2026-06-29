// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./ITypes.sol";

/// @title IInterContract
/// @notice Shared interfaces for cross-contract communication between the three
///         QuadraticMarkets V3 contracts: Core, LiquidityVault, and BetSlips.
///
/// Architecture:
///   Core            — holds USDC treasury, markets, epochs, settlement pipeline
///   LiquidityVault  — LP deposits, withdrawals, NAV, category voting
///   BetSlips        — multi-leg accumulator slips (ownership, placement, settlement)
///
/// State ownership:
///   Core:   markets, epochs, bettor positions, orders, disputes
///   Vault:  lpShares, withdrawalRequests, epoch LP accounting
///   Slips:  betSlips, slipOwner, slipApproved, slipOperatorApprovals
///
/// All contracts share baseToken (USDC). Core is the canonical USDC hub.

interface ICore {
    // ── USDC token ──────────────────────────────────────────────────────────
    function baseToken() external view returns (IERC20);
    function treasuryBalance() external view returns (uint256);
    function freeLiquidity() external view returns (uint256);

    // ── Payout locking (called by Vault/Slips to reserve LP capacity) ───────
    function lockPayout(uint64 epochId, uint256 amount) external;
    function unlockPayout(uint64 epochId, uint256 amount) external;
    function incrementSlipVolume(uint64 marketId, uint8 outcomeId, uint256 amount) external;
    function decrementSlipVolume(uint64 marketId, uint8 outcomeId, uint256 amount) external;

    // ── Market reads (needed by BetSlips to validate legs) ─────────────────
    function getMarket(uint64 marketId) external view returns (Market memory);
    function getMarketStatus(uint64 marketId) external view returns (MarketStatus);
    function getMarketCurrentOdds(uint64 marketId, uint8 outcomeId) external view returns (uint256);
    function getMarketEpochId(uint64 marketId) external view returns (uint64);
    function getMarketStartTime(uint64 marketId) external view returns (uint256);
    function getMarketGroupId(uint64 marketId) external view returns (uint64);
    function getMarketType(uint64 marketId) external view returns (GroupType);
    function getMarketVolumeCap(uint64 marketId, uint8 outcomeId) external view returns (uint256);
    function getMarketVolumeFilled(uint64 marketId, uint8 outcomeId) external view returns (uint256);
    function getMarketSlipVolumeFilled(uint64 marketId, uint8 outcomeId) external view returns (uint256);
    function getMarketWinningOutcome(uint64 marketId) external view returns (uint8);
    function getMarketGroupExposure(uint64 groupId) external view returns (uint256);
    function getMarketMaxGroupExposure(uint64 groupId) external view returns (uint256);
    function getGroupNumMarkets(uint64 groupId) external view returns (uint16);
    function getGroupMarketId(uint64 groupId, uint8 index) external view returns (uint64);

    // ── Epoch reads ─────────────────────────────────────────────────────────
    function getEpochInitialized(uint64 epochId) external view returns (bool);
    function getEpochStartTime(uint64 epochId) external view returns (uint256);
    function getEpochEndTime(uint64 epochId) external view returns (uint256);
    function getEpochTotalLiquidityAdded(uint64 epochId) external view returns (uint256);
    function getEpochMaxExposureMultiplierBps(uint64 epochId) external view returns (uint256);
    function getEpochTotalLockedPayouts(uint64 epochId) external view returns (uint256);
    function getEpochWithdrawalsEnabled(uint64 epochId) external view returns (bool);
    function getEpochAllMarketsSettled(uint64 epochId) external view returns (bool);
    function getEpochNumMarkets(uint64 epochId) external view returns (uint16);
    function getEpochNumSettledMarkets(uint64 epochId) external view returns (uint16);
    function currentEpoch() external view returns (uint64);
    function lastSettledEpoch() external view returns (uint64);
    function hasAnyEpochSettled() external view returns (bool);
    function getWithdrawalCooldownSeconds() external view returns (uint256);

    // ── Epoch exposure helpers ───────────────────────────────────────────────
    function maxEpochExposure(uint64 epochId) external view returns (uint256);
    function epochRemainingCapacity(uint64 epochId) external view returns (uint256);
    function epochPaused() external view returns (bool);
    function paused() external view returns (bool);

    // ── Core → Vault cross-calls ─────────────────────────────────────────────
    function setEpochLiquidityParams(uint64 epochId, uint256 totalLiquidityAdded, uint256 maxExposureMultiplierBps) external;
    function withdrawFromVault(address lp, uint256 amount) external;

    // ── Global risk params (needed by BetSlips) ─────────────────────────────
    function slipHouseMarginBps() external view returns (uint256);
    function maxSlipBonusMultiplierBps() external view returns (uint256);
    function crossMatchBonusPerPairBps() external view returns (uint256);
    function maxSingleBet() external view returns (uint256);
    function maxMarketExposure() external view returns (uint256);

    // ── Setters (admin-only, called after deployment) ────────────────────────
    function setLiquidityVault(address vault) external;
    function setBetSlips(address slips) external;
}

interface ILiquidityVault {
    // ── Deposit ──────────────────────────────────────────────────────────────
    function addLiquidity(uint256 amount) external;

    // ── Withdrawal ───────────────────────────────────────────────────────────
    function requestWithdraw(uint256 shares) external;
    function processWithdrawal() external;

    // ── Category voting ───────────────────────────────────────────────────────
    function voteCategory(SportCategory category) external;

    // ── LP views ────────────────────────────────────────────────────────────
    /// @notice NAV: USDC value per LP share (scaled by ODDS_PRECISION).
    function lpNav() external view returns (uint256);
    function lpSharesOf(address lp) external view returns (uint256);
    function totalLpShares() external view returns (uint256);
    function lpValue(address lp) external view returns (uint256);
    function withdrawalRequests(address lp) external view returns (
        uint256 shares,
        uint256 requestedAt,
        uint256 snapshotNav,
        uint64 epochId,
        bool exists
    );

    // ── Epoch LP state reads ────────────────────────────────────────────────
    function getVaultEpochLiquidityAdded(uint64 epochId) external view returns (uint256);
    function getVaultEpochMaxExposureBps(uint64 epochId) external view returns (uint256);
    function getVaultEpochLockedPayouts(uint64 epochId) external view returns (uint256);
    function getVaultEpochWithdrawalsEnabled(uint64 epochId) external view returns (bool);
    function getVaultEpochInitialized(uint64 epochId) external view returns (bool);

    // ── Cross-contract (called by Core) ─────────────────────────────────────
    function onEpochInit(uint64 epochId, uint256 startTime, uint256 endTime, uint256 maxExposureMultiplierBps) external;
    function onAdvanceEpoch(uint64 prevEpochId) external;
    function withdrawFromVault(address lp, uint256 amount) external;
    function vaultLockPayout(uint64 epochId, uint256 amount) external;
    function vaultUnlockPayout(uint64 epochId, uint256 amount) external;

    // ── Setter ──────────────────────────────────────────────────────────────
    function setCore(address core) external;
}

interface IBetSlips {
    // ── Slip lifecycle ──────────────────────────────────────────────────────
    function placeSlip(PlaceSlipParams calldata p) external returns (uint64 slipId);
    function claimSlipPayout(uint64 slipId) external;
    function claimSlipVoidRefund(uint64 slipId) external;
    function cancelSlip(uint64 slipId) external;
    function settleLostSlip(uint64 slipId) external;

    // ── Slip ownership ──────────────────────────────────────────────────────
    function getSlipOwner(uint64 slipId) external view returns (address);
    function approveSlip(uint64 slipId, address approved) external;
    function setSlipOperator(address operator, bool approved) external;
    function transferSlip(uint64 slipId, address to) external;
    function getSlipApproved(uint64 slipId) external view returns (address);
    function getSlipOperatorApproval(address owner, address operator) external view returns (bool);

    // ── Slip state reads ────────────────────────────────────────────────────
    function getSlipStatus(uint64 slipId) external view returns (SlipStatus);
    function getSlip(uint64 slipId) external view returns (BetSlip memory);
    function getSlipEpochId(uint64 slipId) external view returns (uint64);
    function getSlipPotentialPayout(uint64 slipId) external view returns (uint256);
    function getSlipTotalStake(uint64 slipId) external view returns (uint256);
    function getSlipEpochLockedPayouts(uint64 slipId) external view returns (uint256);
    function slipResult(uint64 slipId) external view returns (bool pending, bool won, bool hasVoid, bool hasLost);
    function nextSlipId() external view returns (uint64);

    // ── Cross-contract (called by Core for settlement) ──────────────────────
    function onMarketSettled(uint64 marketId, uint8 winningOutcome) external;
    function onMarketVoided(uint64 marketId) external;
    function slipsLockPayout(uint64 epochId, uint256 amount) external;
    function slipsUnlockPayout(uint64 epochId, uint256 amount) external;
    function slipsEpochInitialized(uint64 epochId) external view returns (bool);

    // ── Setter ──────────────────────────────────────────────────────────────
    function setCore(address core) external;
}
