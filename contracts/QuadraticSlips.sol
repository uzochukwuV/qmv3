// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./QuadraticLP.sol";
import "./libraries/LibGroupDiscount.sol";
import "./libraries/LibOdds.sol";

/// @title QuadraticSlips
/// @notice Multi-leg accumulator bet slip logic for the QuadraticMarket protocol.
///
/// A bet slip is a multi-leg accumulator: ALL legs must win for payout.
/// The slip is a transferable token: slipOwner[slipId] holds the claim right —
/// enabling a P2P secondary marketplace (Phase 6) where bettors can sell slips
/// before results are finalised.
///
/// Odds math (applied at placement, locked):
///   rawCombined  = product(leg.odds) / ODDS_PRECISION^(n-1)
///   margined     = rawCombined × (BPS − slipHouseMarginBps) / BPS
///   discounted   = margined  × discountBps / BPS          (correlation penalty)
///   bonused      = discounted × (BPS + crossBonusBps) / BPS (cross-match reward)
///   potentialPayout = totalStake × bonused / ODDS_PRECISION
///
/// V1 void rule: if ANY leg's market is voided → full stake refund.
abstract contract QuadraticSlips is QuadraticLP {
    using SafeERC20 for IERC20;

    // ─── Slip Token Ownership ─────────────────────────────────────────────────

    /// @dev Revert if msg.sender is not the slip owner, single approved address,
    ///      or an operator approved by the current owner.
    function _requireSlipAuth(uint64 slipId) internal view {
        address owner = slipOwner[slipId];
        if (owner == address(0)) revert InvalidMarketStatus();
        if (msg.sender == owner)                      return;
        if (msg.sender == slipApproved[slipId])       return;
        if (slipOperatorApprovals[owner][msg.sender]) return;
        revert Unauthorized();
    }

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

    // ─── Place Slip ───────────────────────────────────────────────────────────

    /// @notice Place a multi-leg accumulator bet.
    ///         All legs must be in the same epoch, Open, and not yet started.
    ///         Returns the newly minted slipId.
    ///
    /// @param p  PlaceSlipParams: legs[], numLegs, totalStake, minCombinedOdds
    function placeSlip(
        PlaceSlipParams calldata p
    ) external nonReentrant whenNotPaused returns (uint64 slipId) {
        if (epochPaused)                                  revert ProtocolIsPaused();
        if (p.numLegs < 1 || p.numLegs > MAX_SLIP_LEGS)  revert InvalidOutcomeId();
        if (p.totalStake == 0 || p.totalStake > maxSingleBet) revert InvalidAmount();

        // ── Step 1: validate legs, lock odds, gather discount inputs ──────────
        uint256  combinedOdds = ODDS_PRECISION;
        uint64   epochId      = 0;

        uint64[]    memory groupIds   = new uint64[](p.numLegs);
        GroupType[] memory groupTypes = new GroupType[](p.numLegs);
        bool[]      memory hasGroups  = new bool[](p.numLegs);

        // Pre-allocate storage ref before incrementing nextSlipId
        BetSlip storage slip = betSlips[nextSlipId + 1];

        for (uint8 i = 0; i < p.numLegs; ) {
            PlaceSlipLeg calldata leg = p.legs[i];
            Market storage m = markets[leg.marketId];

            _requireOpen(leg.marketId);
            _requireNotStarted(leg.marketId);
            if (leg.outcomeId >= m.numOutcomes) revert InvalidOutcomeId();

            // All legs must share the same epoch (V1 constraint)
            if (i == 0) {
                epochId = m.epochId;
            } else if (m.epochId != epochId) {
                revert EpochNotInitialized();
            }

            uint256 odds = m.currentOdds[leg.outcomeId];
            if (odds < leg.minOdds) revert OddsSlippageExceeded();

            combinedOdds = (combinedOdds * odds) / ODDS_PRECISION;

            slip.legs[i] = SlipLeg({ marketId: leg.marketId, outcomeId: leg.outcomeId, odds: odds });

            hasGroups[i]  = (m.groupId != 0);
            groupIds[i]   = m.groupId;
            groupTypes[i] = m.marketType;

            unchecked { ++i; }
        }

        // ── Step 2: apply margin + correlation discount + cross-match bonus ────
        uint256 margined    = slipHouseMarginBps > 0
            ? (combinedOdds * (BPS - slipHouseMarginBps)) / BPS
            : combinedOdds;

        uint256 discountBps = LibGroupDiscount.computeSlipDiscountBps(
            groupIds, groupTypes, hasGroups, p.numLegs
        );
        uint256 discounted  = (margined * discountBps) / BPS;

        uint256 crossBonus  = LibGroupDiscount.crossMatchBonusBps(
            groupIds, hasGroups, p.numLegs,
            crossMatchBonusPerPairBps,
            maxSlipBonusMultiplierBps
        );
        uint256 finalOdds   = crossBonus > 0
            ? (discounted * (BPS + crossBonus)) / BPS
            : discounted;

        if (finalOdds < p.minCombinedOdds) revert OddsSlippageExceeded();
        if (finalOdds < LibOdds.MIN_ODDS)  revert OddsBelowMinimum();

        // ── Step 3: compute payout, check LP exposure cap ─────────────────────
        uint256 potentialPayout = (p.totalStake * finalOdds) / ODDS_PRECISION;
        _checkEpochExposure(epochId, potentialPayout);

        // ── Step 4: execute — transfer, mint token, lock payout ───────────────
        baseToken.safeTransferFrom(msg.sender, address(this), p.totalStake);

        unchecked { slipId = ++nextSlipId; }

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

        slipOwner[slipId]    = msg.sender;
        slipApproved[slipId] = address(0);

        _lockPayout(epochId, potentialPayout);

        emit SlipPlaced(slipId, msg.sender, p.numLegs, p.totalStake, potentialPayout);
    }

    // ─── Slip Settlement View ─────────────────────────────────────────────────

    /// @notice Returns the current settlement state of a slip from on-chain data.
    ///
    /// @return pending  At least one leg not yet settled or voided
    /// @return won      Every leg settled on the bettor's chosen outcome
    /// @return hasVoid  At least one leg's market is voided (V1: triggers full refund)
    /// @return hasLost  At least one leg settled on the wrong outcome
    function slipResult(uint64 slipId)
        public view
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
    ///         after all legs win. Payout goes to slipOwner, not the original creator —
    ///         enabling P2P secondary-market settlement.
    function claimSlipPayout(uint64 slipId) external nonReentrant whenNotPaused {
        _requireSlipAuth(slipId);

        BetSlip storage slip = betSlips[slipId];
        if (slip.status != SlipStatus.Active) revert MarketNotSettled();

        (bool pending, bool won, bool hasVoid, bool hasLost) = slipResult(slipId);

        if (hasLost)  revert InvalidMarketStatus();
        if (hasVoid)  revert MarketNotVoidable();
        if (pending)  revert ChallengeWindowActive();
        if (!won)     revert InvalidMarketStatus();

        uint256 payout  = slip.potentialPayout;
        slip.status     = SlipStatus.Claimed;

        address owner = slipOwner[slipId];
        slipOwner[slipId]    = address(0);
        slipApproved[slipId] = address(0);

        _unlockPayout(slip.epochId, payout);

        baseToken.safeTransfer(owner, payout);
        emit SlipClaimed(slipId, owner, payout);
    }

    // ─── Claim Slip Void Refund ───────────────────────────────────────────────

    /// @notice Current owner claims a full stake refund if any leg is voided.
    ///         V1 rule: one void = full refund.
    ///         A losing slip cannot be refunded even if a leg was also voided.
    function claimSlipVoidRefund(uint64 slipId) external nonReentrant whenNotPaused {
        _requireSlipAuth(slipId);

        BetSlip storage slip = betSlips[slipId];
        if (slip.status != SlipStatus.Active) revert InvalidMarketStatus();

        (, , bool hasVoid, bool hasLost) = slipResult(slipId);
        if (!hasVoid) revert MarketNotVoidable();
        if (hasLost)  revert InvalidMarketStatus();

        uint256 stake   = slip.totalStake;
        slip.status     = SlipStatus.Cancelled;

        address owner = slipOwner[slipId];
        slipOwner[slipId]    = address(0);
        slipApproved[slipId] = address(0);

        _unlockPayout(slip.epochId, slip.potentialPayout);

        baseToken.safeTransfer(owner, stake);
        emit SlipVoidRefund(slipId, owner, stake);
    }

    // ─── Cancel Slip (pre-start only) ─────────────────────────────────────────

    /// @notice Owner cancels a slip and recovers stake before any leg's market starts.
    ///         Once ANY leg's market has started the slip is locked in — no cash-out here.
    function cancelSlip(uint64 slipId) external nonReentrant whenNotPaused {
        _requireSlipAuth(slipId);

        BetSlip storage slip = betSlips[slipId];
        if (slip.status != SlipStatus.Active) revert InvalidMarketStatus();

        uint8 numLegs = slip.numLegs;
        for (uint8 i = 0; i < numLegs; ) {
            if (block.timestamp >= markets[slip.legs[i].marketId].startTime) {
                revert MarketAlreadyStarted();
            }
            unchecked { ++i; }
        }

        uint256 stake = slip.totalStake;
        slip.status   = SlipStatus.Cancelled;

        address owner = slipOwner[slipId];
        slipOwner[slipId]    = address(0);
        slipApproved[slipId] = address(0);

        _unlockPayout(slip.epochId, slip.potentialPayout);

        baseToken.safeTransfer(owner, stake);
        emit SlipCancelled(slipId, owner);
    }

    // ─── Slip Config Admin ────────────────────────────────────────────────────

    /// @notice Admin: update multi-leg slip odds parameters.
    ///         Pass type(uint256).max to leave a field unchanged.
    function updateSlipConfig(
        uint256 newSlipMarginBps,
        uint256 newCrossBonusPerPairBps,
        uint256 newMaxCrossBonusBps
    ) external onlyAdmin {
        uint256 MAX = type(uint256).max;
        if (newSlipMarginBps        != MAX) slipHouseMarginBps        = newSlipMarginBps;
        if (newCrossBonusPerPairBps != MAX) crossMatchBonusPerPairBps = newCrossBonusPerPairBps;
        if (newMaxCrossBonusBps     != MAX) maxSlipBonusMultiplierBps = newMaxCrossBonusBps;
    }
}
