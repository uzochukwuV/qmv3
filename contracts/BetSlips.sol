// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./SlipStorage.sol";
import "./interfaces/IInterContract.sol";
import "./libraries/LibGroupDiscount.sol";
import "./libraries/LibOdds.sol";

/// @dev Holds odds computation results to reduce stack pressure.
struct OddsResult {
    uint256 finalOdds;
    uint256 marginBps;
    uint256 discountBps;
    uint256 crossBonus;
    uint64  epochId;
}

/// @title BetSlips
/// @notice Multi-leg accumulator bet slip logic — standalone contract.
///
/// State ownership:
///   BetSlips (this):  slipOwner, slipApproved, slipOperatorApprovals,
///                      betSlips (data), slip counters, slipEpochLockedPayouts
///   Core:             markets, epochs, outcomeBalances, fee params, baseToken treasury
///
/// Odds math (applied at placement, locked):
///   rawCombined  = product(leg.odds) / ODDS_PRECISION^(n-1)
///   margined     = rawCombined × (BPS − slipHouseMarginBps) / BPS
///   discounted   = margined  × discountBps / BPS          (correlation penalty)
///   bonused      = discounted × (BPS + crossBonusBps) / BPS (cross-match reward)
///   potentialPayout = totalStake × bonused / ODDS_PRECISION
///
/// V1 void rule: if ANY leg's market is voided → full stake refund.
contract BetSlips is SlipStorage {
    using SafeERC20 for IERC20;

    // ─── Core reference ───────────────────────────────────────────────────────

    /// @notice Set the Core contract address. Call once after deployment.
    function setCore(address _core) external {
        require(_core != address(0), "ZeroAddress");
        require(core == address(0), "Already initialized");
        core = _core;
    }

    // ─── Epoch lifecycle callbacks ─────────────────────────────────────────────

    /// @notice Called by Core to mark that an epoch has been initialized.
    function slipsEpochInitialized(uint64 epochId) external view returns (bool) {
        if (core == address(0)) return false;
        return ICore(core).getEpochInitialized(epochId);
    }

    // ─── Slip Token Ownership ─────────────────────────────────────────────────

    /// @notice Approve a single address to transfer a specific slip.
    ///         Clears on transfer. Caller must be current owner.
    function approveSlip(uint64 slipId, address approved) external {
        if (slipOwner[slipId] != msg.sender) revert Unauthorized();
        slipApproved[slipId] = approved;
        emit SlipApproved(slipId, msg.sender, approved);
    }

    /// @notice Grant or revoke an operator's rights over ALL of the caller's slips.
    ///         Designed for the Phase 6 marketplace contract.
    function setSlipOperator(address operator, bool approved) external {
        slipOperatorApprovals[msg.sender][operator] = approved;
        emit SlipOperatorSet(msg.sender, operator, approved);
    }

    /// @notice Transfer slip ownership. Caller must be owner, approved address, or operator.
    ///         Clears the per-slip approval on transfer (mirrors ERC721 behaviour).
    function transferSlip(uint64 slipId, address to) external {
        _requireSlipAuth(slipId);
        if (to == address(0)) revert InvalidAmount();
        if (betSlips[slipId].status != SlipStatus.Active) revert InvalidMarketStatus();

        address from = slipOwner[slipId];
        slipOwner[slipId]    = to;
        slipApproved[slipId] = address(0);
        emit SlipTransferred(slipId, from, to);
    }

    // ─── Slip state reads ───────────────────────────────────────────────────

    function getSlipOwner(uint64 slipId) external view returns (address) {
        return slipOwner[slipId];
    }

    function getSlipApproved(uint64 slipId) external view returns (address) {
        return slipApproved[slipId];
    }

    function getSlipOperatorApproval(address owner, address operator) external view returns (bool) {
        return slipOperatorApprovals[owner][operator];
    }

    function getSlipStatus(uint64 slipId) external view returns (SlipStatus) {
        return betSlips[slipId].status;
    }

    function getSlip(uint64 slipId) external view returns (BetSlip memory) {
        return betSlips[slipId];
    }

    function getSlipEpochId(uint64 slipId) external view returns (uint64) {
        return betSlips[slipId].epochId;
    }

    function getSlipPotentialPayout(uint64 slipId) external view returns (uint256) {
        return betSlips[slipId].potentialPayout;
    }

    function getSlipTotalStake(uint64 slipId) external view returns (uint256) {
        return betSlips[slipId].totalStake;
    }

    function getSlipEpochLockedPayouts(uint64 slipId) external view returns (uint256) {
        return slipEpochLockedPayouts[slipId];
    }


    // ─── Place Slip ───────────────────────────────────────────────────────────

    /// @notice Place a multi-leg accumulator bet.
    function placeSlip(PlaceSlipParams calldata p)
        external
        nonReentrant
        whenNotPaused
        returns (uint64 slipId)
    {
        if (core == address(0)) revert Unauthorized();
        ICore c = ICore(core);
        if (c.epochPaused()) revert ProtocolIsPaused();
        uint8 numLegs = p.numLegs;
        if (numLegs < 1 || numLegs > MAX_SLIP_LEGS) revert InvalidOutcomeId();
        uint256 totalStake = p.totalStake;
        if (totalStake == 0 || totalStake > c.maxSingleBet()) revert InvalidAmount();

        // Allocate memory arrays
        uint64[]   memory mIds = new uint64[](numLegs);
        uint8[]    memory oIds = new uint8[](numLegs);
        uint256[]  memory oVals = new uint256[](numLegs);
        uint64[]   memory gIds = new uint64[](numLegs);
        GroupType[] memory gTypes = new GroupType[](numLegs);
        bool[]     memory hasGrp = new bool[](numLegs);

        // Collect legs and compute odds
        OddsResult memory result = _collectAndPrice(c, p, numLegs, mIds, oIds, oVals, gIds, gTypes, hasGrp);

        // Check payout and volume caps
        uint256 payout = (totalStake * result.finalOdds) / ODDS_PRECISION;
        _checkPayoutAndCaps(c, result.epochId, payout, numLegs, mIds, oIds);

        // Increment slip volume tracking on Core for each leg
        for (uint8 i = 0; i < numLegs; ) {
            c.incrementSlipVolume(mIds[i], oIds[i], payout);
            unchecked { ++i; }
        }

        // Mint slip
        unchecked { slipId = ++nextSlipId; }
        _mintSlip(slipId, msg.sender, result.epochId, numLegs, totalStake, result, mIds, oIds, oVals, payout);

        slipOwner[slipId] = msg.sender;
        slipApproved[slipId] = address(0);
        slipEpochLockedPayouts[slipId] = payout;

        c.lockPayout(result.epochId, payout);
        _baseToken().safeTransferFrom(msg.sender, core, totalStake);

        emit SlipPlaced(slipId, msg.sender, numLegs, totalStake, payout);
    }

    /// @dev Checks payout capacity and volume caps per outcome.
    function _checkPayoutAndCaps(
        ICore c, uint64 epochId, uint256 payout, uint8 numLegs,
        uint64[] memory mIds, uint8[] memory oIds
    ) internal view {
        uint256 maxExp = c.maxEpochExposure(epochId);
        uint256 locked = c.getEpochTotalLockedPayouts(epochId);
        if (maxExp == 0) revert InsufficientLiquidity();
        if (locked + payout > maxExp) revert VolumeCapExceeded();
        for (uint8 i = 0; i < numLegs; ) {
            uint256 filled = c.getMarketVolumeFilled(mIds[i], oIds[i])
                           + c.getMarketSlipVolumeFilled(mIds[i], oIds[i]);
            uint256 cap = c.getMarketVolumeCap(mIds[i], oIds[i]);
            if (!LibOdds.withinVolumeCap(filled, cap, payout)) revert VolumeCapExceeded();
            unchecked { ++i; }
        }
    }

    /// @dev Collects leg data, validates markets, and computes final odds.
    function _collectAndPrice(
        ICore c, PlaceSlipParams calldata p, uint8 numLegs,
        uint64[] memory mIds, uint8[] memory oIds, uint256[] memory oVals,
        uint64[] memory gIds, GroupType[] memory gTypes, bool[] memory hasGrp
    ) internal returns (OddsResult memory result) {
        uint256 combinedOdds = ODDS_PRECISION;
        for (uint8 i = 0; i < numLegs; ) {
            uint64 mid = p.legs[i].marketId;
            uint8 oid = p.legs[i].outcomeId;
            uint256 minOd = p.legs[i].minOdds;
            Market memory m = c.getMarket(mid);
            if (m.status != MarketStatus.Open) revert MarketNotOpen();
            if (block.timestamp >= m.startTime) revert MarketAlreadyStarted();
            if (oid >= m.numOutcomes) revert InvalidOutcomeId();
            if (i == 0) result.epochId = m.epochId;
            else if (m.epochId != result.epochId) revert EpochNotInitialized();
            uint256 odds = m.currentOdds[oid];
            if (odds < minOd) revert OddsSlippageExceeded();
            combinedOdds = (combinedOdds * odds) / ODDS_PRECISION;

            mIds[i] = mid;
            oIds[i] = oid;
            oVals[i] = odds;
            hasGrp[i] = (m.groupId != 0);
            gIds[i] = m.groupId;
            gTypes[i] = m.marketType;

            unchecked { ++i; }
        }

        // Compute final odds with discounts
        result.marginBps = c.slipHouseMarginBps();
        result.discountBps = LibGroupDiscount.computeSlipDiscountBps(gIds, gTypes, hasGrp, numLegs);
        result.crossBonus = LibGroupDiscount.crossMatchBonusBps(gIds, hasGrp, numLegs,
            c.crossMatchBonusPerPairBps(), c.maxSlipBonusMultiplierBps());
        uint256 margined = result.marginBps > 0
            ? (combinedOdds * (BPS - result.marginBps)) / BPS : combinedOdds;
        uint256 discounted = (margined * result.discountBps) / BPS;
        result.finalOdds = result.crossBonus > 0
            ? (discounted * (BPS + result.crossBonus)) / BPS : discounted;
        if (result.finalOdds < p.minCombinedOdds) revert OddsSlippageExceeded();
        if (result.finalOdds < LibOdds.MIN_ODDS) revert OddsBelowMinimum();
    }

    /// @dev Writes slip data to storage.
    function _mintSlip(
        uint64 slipId, address creator, uint64 epochId, uint8 numLegs,
        uint256 totalStake, OddsResult memory result,
        uint64[] memory mIds, uint8[] memory oIds, uint256[] memory oVals, uint256 payout
    ) internal {
        BetSlip storage slip = betSlips[slipId];
        slip.slipId = slipId;
        slip.creator = creator;
        slip.epochId = epochId;
        slip.numLegs = numLegs;
        slip.totalStake = totalStake;
        slip.combinedOdds = result.finalOdds;
        slip.houseMarginBps = result.marginBps;
        slip.discountBps = result.discountBps;
        slip.crossBonusBps = result.crossBonus;
        slip.potentialPayout = payout;
        slip.status = SlipStatus.Active;
        slip.createdAt = block.timestamp;

        for (uint8 i = 0; i < numLegs; ) {
            slip.legs[i] = SlipLeg({ marketId: mIds[i], outcomeId: oIds[i], odds: oVals[i] });
            unchecked { ++i; }
        }
    }

    // ─── Slip Settlement View ─────────────────────────────────────────────────

    /// @notice Returns the current settlement state of a slip from on-chain data.
    function slipResult(uint64 slipId)
        public view
        returns (bool pending, bool won, bool hasVoid, bool hasLost)
    {
        if (core == address(0)) return (false, false, false, false);
        ICore c = ICore(core);

        BetSlip storage slip = betSlips[slipId];
        uint8 numLegs = slip.numLegs;
        for (uint8 i = 0; i < numLegs; ) {
            SlipLeg storage leg = slip.legs[i];
            MarketStatus status = c.getMarketStatus(leg.marketId);
            uint8 winningOutcome = c.getMarketWinningOutcome(leg.marketId);

            if      (status == MarketStatus.Voided)  { hasVoid = true; }
            else if (status == MarketStatus.Settled)  {
                if (winningOutcome != leg.outcomeId) hasLost = true;
            } else { pending = true; }
            unchecked { ++i; }
        }
        won = !pending && !hasVoid && !hasLost;
    }

    // ─── Claim Slip Payout ───────────────────────────────────────────────────

    /// @notice Current slip owner (or their approved / operator) claims the payout
    ///         after all legs win.
    function claimSlipPayout(uint64 slipId) external nonReentrant whenNotPaused {
        _requireSlipAuth(slipId);
        if (core == address(0)) revert Unauthorized();

        BetSlip storage slip = betSlips[slipId];
        if (slip.status != SlipStatus.Active) revert MarketNotSettled();

        (bool pending, bool won, bool hasVoid, bool hasLost) = slipResult(slipId);

        if (hasLost)  revert InvalidMarketStatus();
        if (hasVoid)  revert MarketNotVoidable();
        if (pending)  revert ChallengeWindowActive();
        if (!won)     revert InvalidMarketStatus();

        uint256 payout = slip.potentialPayout;
        slip.status    = SlipStatus.Claimed;

        address owner = slipOwner[slipId];
        slipOwner[slipId]    = address(0);
        slipApproved[slipId] = address(0);

        slipEpochLockedPayouts[slipId] = 0;

        // Decrement slip volume tracking and unlock payout
        ICore c = ICore(core);
        for (uint8 i = 0; i < slip.numLegs; ) {
            c.decrementSlipVolume(slip.legs[i].marketId, slip.legs[i].outcomeId, payout);
            unchecked { ++i; }
        }
        c.unlockPayout(slip.epochId, payout);
        _baseToken().safeTransfer(owner, payout);
        emit SlipClaimed(slipId, owner, payout);
    }

    // ─── Claim Slip Void Refund ───────────────────────────────────────────────

    /// @notice Current owner claims a full stake refund if any leg is voided.
    ///         V1 rule: one void = full refund.
    function claimSlipVoidRefund(uint64 slipId) external nonReentrant whenNotPaused {
        _requireSlipAuth(slipId);
        if (core == address(0)) revert Unauthorized();

        BetSlip storage slip = betSlips[slipId];
        if (slip.status != SlipStatus.Active) revert InvalidMarketStatus();

        (, , bool hasVoid, bool hasLost) = slipResult(slipId);
        if (!hasVoid) revert MarketNotVoidable();
        if (hasLost)  revert InvalidMarketStatus();

        uint256 stake = slip.totalStake;
        slip.status    = SlipStatus.Cancelled;

        address owner = slipOwner[slipId];
        slipOwner[slipId]    = address(0);
        slipApproved[slipId] = address(0);

        slipEpochLockedPayouts[slipId] = 0;

        ICore(core).unlockPayout(slip.epochId, slip.potentialPayout);
        _baseToken().safeTransfer(owner, stake);
        emit SlipVoidRefund(slipId, owner, stake);
    }

    // ─── Cancel Slip (pre-start only) ─────────────────────────────────────────

    /// @notice Owner cancels a slip and recovers stake before any leg's market starts.
    function cancelSlip(uint64 slipId) external nonReentrant whenNotPaused {
        _requireSlipAuth(slipId);
        if (core == address(0)) revert Unauthorized();

        BetSlip storage slip = betSlips[slipId];
        if (slip.status != SlipStatus.Active) revert InvalidMarketStatus();

        ICore c = ICore(core);
        uint8 numLegs = slip.numLegs;
        for (uint8 i = 0; i < numLegs; ) {
            if (block.timestamp >= c.getMarketStartTime(slip.legs[i].marketId)) {
                revert MarketAlreadyStarted();
            }
            unchecked { ++i; }
        }

        uint256 stake = slip.totalStake;
        uint256 payout = slip.potentialPayout;
        slip.status   = SlipStatus.Cancelled;

        address owner = slipOwner[slipId];
        slipOwner[slipId]    = address(0);
        slipApproved[slipId] = address(0);

        slipEpochLockedPayouts[slipId] = 0;

        // Decrement slip volume tracking and unlock payout
        for (uint8 i = 0; i < numLegs; ) {
            c.decrementSlipVolume(slip.legs[i].marketId, slip.legs[i].outcomeId, payout);
            unchecked { ++i; }
        }
        c.unlockPayout(slip.epochId, payout);
        _baseToken().safeTransfer(owner, stake);
        emit SlipCancelled(slipId, owner);
    }

    /// @notice Finalize a losing slip and release its reserved LP payout capacity.
    ///         Callable by anyone once at least one leg has settled against the slip.
    function settleLostSlip(uint64 slipId) external nonReentrant whenNotPaused {
        if (core == address(0)) revert Unauthorized();

        BetSlip storage slip = betSlips[slipId];
        if (slip.status != SlipStatus.Active) revert InvalidMarketStatus();

        (, , , bool hasLost) = slipResult(slipId);
        if (!hasLost) revert InvalidMarketStatus();

        uint256 payout = slip.potentialPayout;
        slip.status = SlipStatus.Cancelled;

        address owner = slipOwner[slipId];
        slipOwner[slipId]    = address(0);
        slipApproved[slipId] = address(0);

        slipEpochLockedPayouts[slipId] = 0;

        // Decrement slip volume tracking and unlock payout
        ICore c = ICore(core);
        for (uint8 i = 0; i < slip.numLegs; ) {
            c.decrementSlipVolume(slip.legs[i].marketId, slip.legs[i].outcomeId, payout);
            unchecked { ++i; }
        }
        c.unlockPayout(slip.epochId, payout);
        emit SlipLostSettled(slipId, owner);
    }

    // ─── Cross-contract callbacks (called by Core for settlement) ───────────────

    /// @notice Called by Core when a market is settled. Used for slip result resolution.
    function onMarketSettled(uint64, uint8) external onlyCore {
        // The slipResult() view reads directly from Core's market state,
        // so no additional state update needed here. This callback is a hook
        // for future extensions (e.g., pushing slip state to an oracle).
    }

    /// @notice Called by Core when a market is voided.
    function onMarketVoided(uint64) external onlyCore {
        // Same as above — slipResult() reads market status directly from Core.
    }

    // NOTE: No additional payout locking needed at BetSlips level beyond Core's epoch-level
    // lockPayout/unlockPayout. Slip-specific volume tracking happens on Core via the
    // Market.slipVolumeFilled field.
}
