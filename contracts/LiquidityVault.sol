// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./VaultStorage.sol";

/// @title LiquidityVault
/// @notice LP vault: deposits, withdrawals, NAV, category voting.
///
/// Cross-contract design:
///   - Vault holds LP share accounting state (lpShares, totalLpShares, etc.)
///   - Core holds the USDC treasury and the epoch's totalLiquidityAdded
///   - Vault calls Core to lock/unlock payout capacity and to initiate USDC transfers
///
/// Epoch lifecycle:
///   1. Core.initEpoch() → Core calls Vault.onEpochInit() → deposit window opens
///   2. LPs call addLiquidity() — only while block.timestamp < epoch.startTime
///   3. LPs optionally call voteCategory()
///   4. Core advances epoch → Core calls Vault.onAdvanceEpoch()
///   5. LPs call requestWithdraw() → wait cooldown → processWithdrawal()
contract LiquidityVault is VaultStorage {
    using SafeERC20 for IERC20;

    // ─── Core reference ───────────────────────────────────────────────────────

    /// @notice Set the Core contract address and initial admin. Call once after deployment.
    function setCore(address _core) external {
        require(_core != address(0), "ZeroAddress");
        require(admin == address(0), "Already initialized");
        core = _core;
        admin = msg.sender;
    }

    // ─── Epoch lifecycle callbacks ─────────────────────────────────────────────

    /// @notice Called by Core.initEpoch() to open the deposit window for a new epoch.
    function onEpochInit(
        uint64 epochId,
        uint256 /* startTime */,
        uint256 /* endTime */,
        uint256 maxExposureMultiplierBps
    ) external onlyCore {
        epochInitialized[epochId]    = true;
        epochWithdrawalsEnabled[epochId] = false;
        epochLiquidityAdded[epochId]  = 0;
        epochMaxExposureBps[epochId]  = maxExposureMultiplierBps;
    }

    /// @notice Called by Core.advanceEpoch() to enable withdrawals for the completed epoch.
    function onAdvanceEpoch(uint64 prevEpochId) external onlyCore {
        epochWithdrawalsEnabled[prevEpochId] = true;
    }

    // ─── Deposit ──────────────────────────────────────────────────────────────

    /// @notice Deposit USDC into the LP vault for the current epoch.
    ///         Only callable during the deposit window (before epoch.startTime).
    ///         Mints LP shares at current NAV using the virtual-offset ERC4626 formula.
    ///
    /// @param amount  USDC amount to deposit (in base-token units, 6 decimals).
    function addLiquidity(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();
        if (core == address(0)) revert Unauthorized();

        // Read epoch state from Core
        ICore c = ICore(core);
        uint64 eid = c.currentEpoch();

        if (!epochInitialized[eid]) revert EpochNotInitialized();
        uint256 startTime = c.getEpochStartTime(eid);
        if (block.timestamp >= startTime) revert EpochLiquidityGated();

        // Virtual-offset formula: shares = amount × (supply+1) / (balance+1)
        // Balance sampled BEFORE safeTransferFrom so incoming tokens don't inflate denominator.
        uint256 bal = _baseToken().balanceOf(core);
        uint256 shares = (amount * (totalLpShares + 1)) / (bal + 1);
        if (shares == 0) revert InvalidAmount();

        IERC20(address(_baseToken())).safeTransferFrom(msg.sender, core, amount);

        lpShares[msg.sender]                      += shares;
        totalLpShares                             += shares;
        lpDepositsPerEpoch[msg.sender][eid]      += amount;
        epochLiquidityAdded[eid]                  += amount;

        // Sync totalLiquidityAdded to Core so exposure checks stay accurate
        c.setEpochLiquidityParams(eid, epochLiquidityAdded[eid], epochMaxExposureBps[eid]);

        emit LiquidityAdded(msg.sender, amount, shares, eid);
    }

    // ─── Withdrawal Queue ─────────────────────────────────────────────────────

    /// @notice Queue an LP withdrawal for `shares` of the LP vault.
    ///         Requires at least one epoch to have fully settled (anyEpochSettled).
    ///         A cooldown period must pass before processWithdrawal() executes.
    ///
    /// @param shares  Number of LP shares to redeem.
    function requestWithdraw(uint256 shares) external whenNotPaused {
        if (shares == 0) revert InvalidAmount();
        if (lpShares[msg.sender] < shares) revert InsufficientLiquidity();
        if (withdrawalRequests[msg.sender].exists) revert WithdrawalCooldownActive();
        if (core == address(0)) revert Unauthorized();

        ICore c = ICore(core);
        uint64 settledEpoch = c.getEpochInitialized(0) ? 0 : c.lastSettledEpoch();
        // Must have at least one settled epoch
        if (settledEpoch == 0 && !c.hasAnyEpochSettled()) revert EpochNotSettled();

        withdrawalRequests[msg.sender] = WithdrawalRequest({
            shares:      shares,
            requestedAt: block.timestamp,
            snapshotNav: lpNav(),
            epochId:     settledEpoch,
            exists:      true
        });

        emit WithdrawalRequested(msg.sender, shares, settledEpoch);
    }

    /// @notice Execute a queued withdrawal after the cooldown period.
    ///         Redeems LP shares at the worse of snapshot NAV vs current NAV
    ///         (LP bears post-request losses but cannot harvest post-request gains).
    ///         Reverts if free liquidity is insufficient.
    function processWithdrawal() external nonReentrant whenNotPaused {
        if (core == address(0)) revert Unauthorized();

        WithdrawalRequest storage req = withdrawalRequests[msg.sender];
        if (!req.exists) revert NoPendingWithdrawal();

        ICore c = ICore(core);
        // Can only withdraw once the request's epoch has withdrawals enabled
        if (!epochWithdrawalsEnabled[req.epochId]) revert EpochNotSettled();
        if (block.timestamp < req.requestedAt + c.getWithdrawalCooldownSeconds()) {
            revert WithdrawalCooldownActive();
        }

        uint256 shares = req.shares;
        if (lpShares[msg.sender] < shares) revert InsufficientLiquidity();

        uint256 currentNav = lpNav();
        uint256 navToUse   = currentNav < req.snapshotNav ? currentNav : req.snapshotNav;
        uint256 amount     = (shares * navToUse) / ODDS_PRECISION;
        if (amount == 0) revert InvalidAmount();
        if (amount > c.freeLiquidity()) revert InsufficientLiquidity();

        lpShares[msg.sender] -= shares;
        totalLpShares        -= shares;

        delete withdrawalRequests[msg.sender];

        // Pull USDC from Core and send to LP
        c.withdrawFromVault(msg.sender, amount);
        emit WithdrawalProcessed(msg.sender, amount, shares);
    }

    // ─── Category Voting ──────────────────────────────────────────────────────

    /// @notice Vote on which sport category should have markets in the next epoch.
    ///         Vote weight = caller's current LP share balance.
    ///         One vote per LP per epoch (changing vote not supported).
    ///
    /// @param category  The SportCategory to vote for.
    function voteCategory(SportCategory category) external whenNotPaused {
        if (lpShares[msg.sender] == 0) revert InsufficientLiquidity();
        if (core == address(0)) revert Unauthorized();

        ICore c = ICore(core);
        uint64 eid = c.currentEpoch();

        if (!epochInitialized[eid]) revert EpochNotInitialized();

        uint8 catKey = uint8(category);
        if (lpCategoryVote[msg.sender][eid] != 0) revert InvalidAmount(); // already voted

        uint256 weight = lpShares[msg.sender];
        lpCategoryVote[msg.sender][eid]  = catKey + 1; // +1: 0 = no vote sentinel
        epochCategoryVotes[eid][catKey]  += weight;

        emit CategoryVoted(msg.sender, eid, category, weight);
    }

    // ─── LP Views ─────────────────────────────────────────────────────────────

    /// @notice Current LP share NAV: USDC value per share (scaled by ODDS_PRECISION).
    ///         Computed from Core's treasury balance and Vault's total LP shares.
    function lpNav() public view returns (uint256) {
        if (core == address(0)) return ODDS_PRECISION;
        if (totalLpShares == 0) return ODDS_PRECISION;
        IERC20 tok = _baseToken();
        uint256 bal = tok.balanceOf(core);
        return (bal * ODDS_PRECISION) / totalLpShares;
    }

    /// @notice USDC value of an LP's entire share balance at current NAV.
    function lpValue(address lp) external view returns (uint256) {
        if (totalLpShares == 0 || core == address(0)) return 0;
        IERC20 tok = ICore(core).baseToken();
        uint256 bal = tok.balanceOf(core);
        return (lpShares[lp] * bal) / totalLpShares;
    }

    /// @notice LP shares held by an address.
    function lpSharesOf(address lp) external view returns (uint256) {
        return lpShares[lp];
    }

    // ─── Epoch LP state reads (called by Core) ─────────────────────────────────

    function getVaultEpochLiquidityAdded(uint64 epochId) external view returns (uint256) {
        return epochLiquidityAdded[epochId];
    }

    function getVaultEpochMaxExposureBps(uint64 epochId) external view returns (uint256) {
        return epochMaxExposureBps[epochId];
    }

    function getVaultEpochLockedPayouts(uint64 epochId) external view returns (uint256) {
        return epochLockedPayouts[epochId];
    }

    function getVaultEpochWithdrawalsEnabled(uint64 epochId) external view returns (bool) {
        return epochWithdrawalsEnabled[epochId];
    }

    function getVaultEpochInitialized(uint64 epochId) external view returns (bool) {
        return epochInitialized[epochId];
    }

    // ─── Cross-contract calls (called by Core) ─────────────────────────────────

    /// @notice Called by Core.processWithdrawal to transfer USDC to the LP.
    function withdrawFromVault(address lp, uint256 amount) external onlyCore {
        if (core == address(0)) revert Unauthorized();
        IERC20 tok = _baseToken();
        tok.safeTransfer(lp, amount);
    }

    /// @notice Lock payout capacity for an epoch (called by Core on bet placement).
    function vaultLockPayout(uint64 epochId, uint256 amount) external onlyCore {
        epochLockedPayouts[epochId] += amount;
    }

    /// @notice Unlock payout capacity for an epoch (called by Core on settlement).
    function vaultUnlockPayout(uint64 epochId, uint256 amount) external onlyCore {
        uint256 cur = epochLockedPayouts[epochId];
        epochLockedPayouts[epochId] = cur > amount ? cur - amount : 0;
    }
}
