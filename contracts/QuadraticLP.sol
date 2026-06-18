// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./QuadraticMarketStorage.sol";

/// @title QuadraticLP
/// @notice LP vault logic for the QuadraticMarket protocol.
///
/// Epoch lifecycle for LPs:
///   1. Admin calls initEpoch(epochStartTime, multiplierBps)
///   2. LPs call addLiquidity() — only accepted while block.timestamp < epoch.startTime
///   3. LPs optionally call voteCategory() to influence which sport gets markets
///   4. Admin creates markets once epoch.startTime passes
///   5. Bettors place bets; exposure cap enforced per bet
///   6. epoch.endTime passes → oracle settles markets → advanceEpoch()
///   7. LPs call requestWithdraw() → wait cooldown → processWithdrawal()
///
/// NAV formula (ERC4626 virtual-offset, inflation-attack safe):
///   shares_out = amount × (totalSupply + 1) / (vaultBalance + 1)
///   amount_out = shares  × min(currentNav, snapshotNav) / ODDS_PRECISION
abstract contract QuadraticLP is QuadraticMarketStorage {
    using SafeERC20 for IERC20;

    // ─── Deposit ──────────────────────────────────────────────────────────────

    /// @notice Deposit USDC into the LP vault for the current epoch.
    ///         Only callable during the deposit window (before epoch.startTime).
    ///         Mints LP shares at current NAV using the virtual-offset ERC4626 formula.
    ///
    /// @param amount  USDC amount to deposit (in base-token units, 6 decimals).
    function addLiquidity(uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert InvalidAmount();

        Epoch storage ep = epochs[currentEpoch];
        if (!ep.initialized) revert EpochNotInitialized();
        if (block.timestamp >= ep.startTime) revert EpochLiquidityGated();

        // Virtual-offset formula: shares = amount × (supply+1) / (balance+1)
        // Balance sampled BEFORE safeTransferFrom so incoming tokens don't inflate denominator.
        uint256 bal    = baseToken.balanceOf(address(this));
        uint256 shares = (amount * (totalLpShares + 1)) / (bal + 1);
        if (shares == 0) revert InvalidAmount();

        baseToken.safeTransferFrom(msg.sender, address(this), amount);

        lpShares[msg.sender]                         += shares;
        totalLpShares                                += shares;
        lpDepositsPerEpoch[msg.sender][currentEpoch] += amount;
        ep.totalLiquidityAdded                       += amount;

        emit LiquidityAdded(msg.sender, amount, shares, currentEpoch);
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

        _requireWithdrawalsOpen();

        withdrawalRequests[msg.sender] = WithdrawalRequest({
            shares:      shares,
            requestedAt: block.timestamp,
            snapshotNav: lpNav(),   // NAV floor: LP gets min(snapshotNav, currentNav) on exit
            epochId:     lastSettledEpoch,
            exists:      true
        });

        emit WithdrawalRequested(msg.sender, shares, lastSettledEpoch);
    }

    /// @notice Execute a queued withdrawal after the cooldown period.
    ///         Redeems LP shares at the worse of snapshot NAV vs current NAV
    ///         (LP bears post-request losses but cannot harvest post-request gains).
    ///         Reverts if free liquidity is insufficient.
    function processWithdrawal() external nonReentrant whenNotPaused {
        WithdrawalRequest storage req = withdrawalRequests[msg.sender];
        if (!req.exists) revert NoPendingWithdrawal();
        _requireWithdrawalsOpen();
        if (!epochs[req.epochId].withdrawalsEnabled) revert EpochNotSettled();
        if (block.timestamp < req.requestedAt + withdrawalCooldownSeconds) {
            revert WithdrawalCooldownActive();
        }

        uint256 shares = req.shares;
        if (lpShares[msg.sender] < shares) revert InsufficientLiquidity();

        uint256 currentNav = lpNav();
        uint256 navToUse   = currentNav < req.snapshotNav ? currentNav : req.snapshotNav;
        uint256 amount     = (shares * navToUse) / ODDS_PRECISION;
        if (amount == 0) revert InvalidAmount();
        if (amount > freeLiquidity()) revert InsufficientLiquidity();

        lpShares[msg.sender] -= shares;
        totalLpShares        -= shares;
        epochs[req.epochId].totalLiquidityRemoved += amount;

        delete withdrawalRequests[msg.sender];

        baseToken.safeTransfer(msg.sender, amount);
        emit WithdrawalProcessed(msg.sender, amount, shares);
    }

    // ─── Category Voting ──────────────────────────────────────────────────────

    /// @notice Vote on which sport category should have markets in the next epoch.
    ///         Vote weight = caller's current LP share balance.
    ///         One vote per LP per epoch (changing vote not supported).
    ///         Admin reads the winning category off-chain and creates markets accordingly.
    ///
    /// @param category  The SportCategory to vote for.
    function voteCategory(SportCategory category) external whenNotPaused {
        if (lpShares[msg.sender] == 0) revert InsufficientLiquidity();

        uint64 eid    = currentEpoch;
        uint8  catKey = uint8(category);

        if (lpCategoryVote[msg.sender][eid] != 0) revert InvalidAmount(); // already voted

        uint256 weight = lpShares[msg.sender];
        lpCategoryVote[msg.sender][eid]  = catKey + 1; // +1: 0 = no vote sentinel
        epochCategoryVotes[eid][catKey] += weight;

        uint8 winner = epochs[eid].winningSportCategory;
        if (epochCategoryVotes[eid][catKey] > epochCategoryVotes[eid][winner]) {
            epochs[eid].winningSportCategory = catKey;
        }

        emit CategoryVoted(msg.sender, eid, category, weight);
    }
}
