// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

import "./QuadraticSlips.sol";
import "./libraries/LibOdds.sol";

/// @title QuadraticMarket
/// @notice Decentralized fixed-odds sports betting protocol — deployed contract.
///
/// This is the thin concrete leaf of the inheritance chain:
///   QuadraticMarketStorage → QuadraticLP → QuadraticSlips → QuadraticMarket
///
/// Responsibilities:
///   • Constructor + protocol initialisation
///   • Admin & operator management
///   • Epoch lifecycle (initEpoch / advanceEpoch)
///   • Market group + market creation
///   • Oracle odds updates (ECDSA-signed)
///   • Single-outcome bet placement (buyAtOdds)
///   • Settlement pipeline: proposeResult → adminOverride / finalizeResult → claimPayout
///   • Permissionless void safety net (voidIfExpired)
///
/// LP vault logic lives in QuadraticLP.sol.
/// Multi-leg slip logic lives in QuadraticSlips.sol.
contract QuadraticMarket is QuadraticSlips {
    using SafeERC20 for IERC20;

    // ─── Constructor ──────────────────────────────────────────────────────────

    /// @param _baseToken   USDC (or any 6-decimal ERC20) used for all stakes/payouts.
    /// @param _oracle      Address whose ECDSA signatures authorize odds updates & settlement.
    /// @param _maxExposure Default max per-market LP exposure (in base token units).
    constructor(
        address _baseToken,
        address _oracle,
        uint256 _maxExposure
    ) {
        if (_baseToken == address(0)) revert ZeroAddress();
        if (_oracle    == address(0)) revert ZeroAddress();

        admin             = msg.sender;
        treasury          = address(this);
        oracle            = _oracle;
        baseToken         = IERC20(_baseToken);
        maxMarketExposure = _maxExposure;

        // Default protocol parameters
        challengeWindowSeconds    = 300;            // 5 minutes
        settlementDeadlineSeconds = 14_400;         // 4 hours
        withdrawalCooldownSeconds = 86_400;         // 24 hours
        epochDurationSeconds      = 86_400;         // 24 hours
        slipHouseMarginBps        = 300;            // 3% per leg
        maxSlipBonusMultiplierBps = 3_500;          // +35% max cross-match bonus
        crossMatchBonusPerPairBps = 125;            // +1.25% per independent pair
        maxSingleBet              = 10_000_000_000; // 10 000 USDC (6-decimal)
        cashOutMarginBps          = 500;            // 5% early exit cut
        buyFeeBps                 = 100;            // 1% direct purchase fee
        nextMarketId              = 1;
        nextGroupId               = 1;
        nextSlipId                = 0;
        nextOrderId               = 1;
        currentEpoch              = 0;
        nextEpochStart            = block.timestamp + epochDurationSeconds;

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
                _operators[i]     = _operators[n - 1];
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

    /// @notice Initialize the on-chain Epoch record for currentEpoch.
    ///         Opens the LP deposit window immediately. Deposits close at epochStartTime.
    ///
    /// @param epochStartTime          Unix timestamp when trading opens and deposits close.
    /// @param maxExposureMultiplierBps  e.g. 15 000 = 1.5× — LP can lose at most 50% of deposit.
    function initEpoch(
        uint256 epochStartTime,
        uint256 maxExposureMultiplierBps
    ) external onlyAuthorized {
        uint64 eid    = currentEpoch;
        Epoch storage ep = epochs[eid];
        if (ep.initialized) revert EpochAlreadyInitialized();
        if (epochStartTime <= block.timestamp) revert InvalidAmount();

        uint256 endTime = epochStartTime + epochDurationSeconds;

        ep.epochId                  = eid;
        ep.startTime                = epochStartTime;
        ep.endTime                  = endTime;
        ep.initialized              = true;
        ep.allMarketsSettled        = true;
        ep.withdrawalsEnabled       = false;
        ep.lpSharesAtClose          = 0;
        ep.totalLiquidityAdded      = 0;
        ep.totalLiquidityRemoved    = 0;
        ep.numMarkets               = 0;
        ep.numSettledMarkets        = 0;
        ep.totalLockedPayouts       = 0;
        ep.maxExposureMultiplierBps = maxExposureMultiplierBps > 0 ? maxExposureMultiplierBps : 15_000;
        ep.winningSportCategory     = 0;
        nextEpochStart              = endTime;

        emit EpochInitialized(eid, epochStartTime, endTime);
        emit EpochDepositsGated(eid, epochStartTime);
    }

    /// @notice Advance to the next epoch once all current-epoch markets are settled.
    ///         Flips withdrawalsEnabled on the completed epoch. Call initEpoch() next.
    function advanceEpoch() external onlyAuthorized {
        Epoch storage ep = epochs[currentEpoch];
        if (!ep.initialized) revert EpochNotInitialized();
        if (ep.numMarkets == 0 && block.timestamp < ep.endTime) revert EpochNotSettled();
        if (ep.numMarkets > 0 && ep.numSettledMarkets < ep.numMarkets) {
            revert EpochNotSettled();
        }

        ep.allMarketsSettled  = true;
        ep.withdrawalsEnabled = true;
        ep.lpSharesAtClose    = totalLpShares;
        anyEpochSettled       = true;
        lastSettledEpoch      = currentEpoch;

        uint64 prev = currentEpoch;
        unchecked { ++currentEpoch; }
        epochPaused = false;

        emit EpochAdvanced(prev, currentEpoch);
    }

    // ─── Market Groups ────────────────────────────────────────────────────────

    /// @notice Create a new MarketGroup (the real-world event / match).
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
        mg.currentExposure  = 0;
        mg.numMarkets       = 0;
        mg.exists           = true;

        emit MarketGroupCreated(groupId, title, eventStartTime);
    }

    // ─── Market Lifecycle ─────────────────────────────────────────────────────

    /// @notice Create an individual betting market (PreOpen) inside a MarketGroup.
    ///         Status is PreOpen until openMarket() is called once the epoch starts.
    ///         The oddsAnchor array must carry a valid oracle ECDSA signature.
    function createMarket(CreateMarketParams calldata p) external onlyAuthorized returns (uint64 marketId) {
        Epoch storage ep = epochs[currentEpoch];
        if (!ep.initialized)                                    revert EpochNotInitialized();
        if (p.numOutcomes < 2 || p.numOutcomes > MAX_OUTCOMES)  revert InvalidNumOutcomes();
        if (p.startTime <= block.timestamp)                     revert InvalidAmount();

        _verifyCreateMarketSig(p);
        unchecked { ++marketCreationNonce; }
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
        m.maxDeviationBps = p.maxDeviationBps > 0 ? p.maxDeviationBps : 1_000;

        uint256 autoVol = _autoVolumeCap(ep, p.numOutcomes);
        for (uint8 i = 0; i < p.numOutcomes; ) {
            if (p.oddsAnchor[i] < LibOdds.MIN_ODDS) revert OddsBelowMinimum();
            m.oddsAnchor[i]  = p.oddsAnchor[i];
            m.currentOdds[i] = p.oddsAnchor[i];
            m.volumeCap[i]   = p.volumeCap[i] > 0 ? p.volumeCap[i] : autoVol;
            unchecked { ++i; }
        }
        m.oddsLastUpdated = block.timestamp;

        if (m.hasGroup) {
            MarketGroup storage mg = marketGroups[p.groupId];
            if (!mg.exists)                      revert GroupNotFound();
            if (mg.numMarkets >= MAX_GROUP_MKTS) revert GroupFull();
            m.groupMarketIndex          = mg.numMarkets;
            mg.marketIds[mg.numMarkets] = marketId;
            unchecked { ++mg.numMarkets; }
            emit MarketAddedToGroup(p.groupId, marketId, m.groupMarketIndex);
        }

        unchecked { ++ep.numMarkets; }
        ep.allMarketsSettled = false;

        emit MarketCreated(marketId, p.groupId, p.marketType, p.title, p.startTime);
    }

    /// @notice Flip a single PreOpen market to Open (epoch must have started).
    function openMarket(uint64 marketId) public onlyAuthorized {
        Market storage m = markets[marketId];
        if (m.marketId == 0 || m.status != MarketStatus.PreOpen) revert InvalidMarketStatus();

        Epoch storage ep = epochs[m.epochId];
        if (!ep.initialized)               revert EpochNotInitialized();
        if (block.timestamp < ep.startTime) revert EpochLiquidityGated();

        m.status = MarketStatus.Open;
        emit MarketStatusChanged(marketId, MarketStatus.Open);
    }

    /// @notice Batch-open multiple PreOpen markets. Silently skips ineligible markets.
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
    ///         Only callable before market.startTime. Each new value is validated
    ///         against the creation-time anchor via LibOdds.withinDeviation.
    function updateOdds(
        uint64                        marketId,
        uint256[MAX_OUTCOMES] calldata newOdds,
        uint256                       sigDeadline,
        bytes calldata                sig
    ) external onlyAuthorized {
        if (block.timestamp > sigDeadline) revert ChallengeWindowExpired();

        Market storage m = markets[marketId];
        if (m.marketId == 0) revert InvalidMarketStatus();
        if (m.status != MarketStatus.Open && m.status != MarketStatus.PreOpen) {
            revert InvalidMarketStatus();
        }
        if (block.timestamp >= m.startTime) revert MarketAlreadyStarted();

        bytes32 msgHash = keccak256(abi.encodePacked(
            "QM:updateOdds", block.chainid, address(this), marketId, newOdds, sigDeadline
        ));
        address signer = ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(msgHash), sig);
        if (signer != oracle) revert InvalidOracleSignature();

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
    ///         `minOdds` is mandatory — it protects the bettor from front-running.
    ///
    /// @param marketId   Target market
    /// @param outcomeId  Outcome index to back (0-indexed)
    /// @param stake      USDC to stake (6-decimal units)
    /// @param minOdds    Minimum acceptable odds (× ODDS_PRECISION)
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
        if (odds < minOdds) revert OddsSlippageExceeded();

        uint256 effectiveStake = buyFeeBps > 0
            ? (stake * (BPS - buyFeeBps)) / BPS
            : stake;

        uint256 payout = LibOdds.computePayout(effectiveStake, odds);

        if (!LibOdds.withinVolumeCap(m.volumeFilled[outcomeId], m.volumeCap[outcomeId], payout)) {
            revert VolumeCapExceeded();
        }
        if (m.hasGroup) {
            MarketGroup storage mg = marketGroups[m.groupId];
            if (mg.currentExposure + payout > mg.maxGroupExposure) revert VolumeCapExceeded();
            mg.currentExposure += payout;
        }
        _checkEpochExposure(m.epochId, payout);

        baseToken.safeTransferFrom(msg.sender, address(this), stake);

        outcomeBalances[msg.sender][marketId][outcomeId] += payout;
        outcomeStakes[msg.sender][marketId][outcomeId]   += stake;

        m.volumeFilled[outcomeId] += payout;
        m.lockedPayout            += payout;
        m.backing                 += stake;
        _lockPayout(m.epochId, payout);

        emit BetPlaced(marketId, msg.sender, outcomeId, stake, odds, payout);
    }

    // ─── Permissionless Void Safety Net ──────────────────────────────────────

    /// @notice Void a market if the oracle has not settled it within
    ///         settlementDeadlineSeconds after market.startTime. Permissionless.
    function voidIfExpired(uint64 marketId) external {
        Market storage m = markets[marketId];
        if (m.marketId == 0)                      revert InvalidMarketStatus();
        if (m.status == MarketStatus.Settled)      revert MarketAlreadySettled();
        if (m.status == MarketStatus.Voided)       revert MarketAlreadySettled();
        if (block.timestamp < m.startTime + settlementDeadlineSeconds) {
            revert SettlementDeadlineNotPassed();
        }

        m.status = MarketStatus.Voided;
        _unlockPayout(m.epochId, m.lockedPayout);
        m.lockedPayout = 0;

        Epoch storage ep = epochs[m.epochId];
        unchecked { ++ep.numSettledMarkets; }
        if (ep.numSettledMarkets >= ep.numMarkets) ep.allMarketsSettled = true;

        emit MarketStatusChanged(marketId, MarketStatus.Voided);
    }

    // ─── Settlement Pipeline ──────────────────────────────────────────────────

    /// @notice Oracle proposes the winning outcome. Opens a challenge window.
    ///         Accepts Open, Suspended, or AwaitingResult markets past startTime.
    function proposeResult(
        uint64  marketId,
        uint8   winningOutcome,
        uint256 sigDeadline,
        bytes calldata sig
    ) external onlyAuthorized {
        if (block.timestamp > sigDeadline) revert ChallengeWindowExpired();

        Market storage m = markets[marketId];
        if (m.marketId == 0) revert InvalidMarketStatus();
        if (block.timestamp < m.startTime) revert MarketNotOpen();
        if (m.status != MarketStatus.Open        &&
            m.status != MarketStatus.Suspended   &&
            m.status != MarketStatus.AwaitingResult) {
            revert InvalidMarketStatus();
        }
        if (winningOutcome >= m.numOutcomes) revert InvalidOutcomeId();

        bytes32 msgHash = keccak256(abi.encodePacked(
            "QM:proposeResult", block.chainid, address(this), marketId, winningOutcome, sigDeadline
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

    /// @notice Admin corrects an oracle result within the challenge window.
    ///         Immediately finalizes with the corrected outcome.
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
        _finalizeMarket(marketId, correctedOutcome);
    }

    /// @notice Finalize a market after the challenge window elapses. Permissionless.
    function finalizeResult(uint64 marketId) external {
        Market storage m = markets[marketId];
        if (m.status != MarketStatus.Proposed) revert InvalidMarketStatus();

        Dispute storage d = disputes[marketId];
        if (block.timestamp < d.challengeDeadline) revert ChallengeWindowActive();

        d.status = DisputeStatus.Resolved;
        _finalizeMarket(marketId, m.winningOutcome);
    }

    // ─── Bettor Claims ────────────────────────────────────────────────────────

    /// @notice Winning bettors claim USDC payout after market settles.
    function claimPayout(uint64 marketId) external nonReentrant whenNotPaused {
        Market storage m = markets[marketId];
        if (m.status != MarketStatus.Settled) revert MarketNotSettled();

        uint8   winner = m.winningOutcome;
        uint256 payout = outcomeBalances[msg.sender][marketId][winner];
        if (payout == 0) revert InvalidAmount();

        outcomeBalances[msg.sender][marketId][winner] = 0;
        outcomeStakes[msg.sender][marketId][winner]   = 0;

        _unlockPayout(m.epochId, payout);
        baseToken.safeTransfer(msg.sender, payout);
        emit PayoutClaimed(marketId, msg.sender, payout);
    }

    /// @notice Bettors reclaim exact stake on a voided market.
    function claimVoidRefund(uint64 marketId, uint8 outcomeId) external nonReentrant whenNotPaused {
        Market storage m = markets[marketId];
        if (m.status != MarketStatus.Voided) revert MarketNotVoidable();

        uint256 stake = outcomeStakes[msg.sender][marketId][outcomeId];
        if (stake == 0) revert InvalidAmount();

        outcomeStakes[msg.sender][marketId][outcomeId]   = 0;
        outcomeBalances[msg.sender][marketId][outcomeId] = 0;

        baseToken.safeTransfer(msg.sender, stake);
        emit PayoutClaimed(marketId, msg.sender, stake);
    }

    // ─── Internal helpers (Phase 3 + 4) ──────────────────────────────────────

    /// @dev Verify oracle ECDSA signature for createMarket's oddsAnchor.
    function _verifyCreateMarketSig(CreateMarketParams calldata p) internal view {
        if (block.timestamp > p.sigDeadline) revert ChallengeWindowExpired();
        bytes32 msgHash = keccak256(abi.encode(
            "QM:createMarket:v2",
            block.chainid,
            address(this),
            currentEpoch,
            marketCreationNonce,
            p.groupId,
            keccak256(bytes(p.title)),
            keccak256(bytes(p.description)),
            p.startTime,
            p.numOutcomes,
            p.marketType,
            p.category,
            p.oddsAnchor,
            p.maxDeviationBps,
            p.volumeCap,
            p.sigDeadline
        ));
        address signer = ECDSA.recover(
            MessageHashUtils.toEthSignedMessageHash(msgHash),
            p.oracleSig
        );
        if (signer != oracle) revert InvalidOracleSignature();
    }

    /// @dev Compute auto volume cap = epochMaxExposure / numOutcomes.
    function _autoVolumeCap(Epoch storage ep, uint8 numOutcomes) internal view returns (uint256) {
        uint256 epochMax = LibOdds.maxEpochExposure(ep.totalLiquidityAdded, ep.maxExposureMultiplierBps);
        if (epochMax == 0) epochMax = maxMarketExposure;
        return epochMax / numOutcomes;
    }

    /// @dev Core settlement logic shared by adminOverride and finalizeResult.
    ///
    ///      Non-winning outcome payouts are unlocked immediately (LP liquidity freed).
    ///      Winning payouts remain locked until each bettor calls claimPayout().
    function _finalizeMarket(uint64 marketId, uint8 winningOutcome) internal {
        Market storage m = markets[marketId];

        uint256 winLiability = m.volumeFilled[winningOutcome];
        for (uint8 i = 0; i < m.numOutcomes; ) {
            if (i != winningOutcome && m.volumeFilled[i] > 0) {
                _unlockPayout(m.epochId, m.volumeFilled[i]);
            }
            unchecked { ++i; }
        }

        m.lockedPayout   = winLiability;
        m.status         = MarketStatus.Settled;
        m.winningOutcome = winningOutcome;

        Epoch storage ep = epochs[m.epochId];
        unchecked { ++ep.numSettledMarkets; }
        if (ep.numSettledMarkets >= ep.numMarkets) ep.allMarketsSettled = true;

        emit MarketFinalized(marketId, winningOutcome);
        emit MarketStatusChanged(marketId, MarketStatus.Settled);
    }
}
