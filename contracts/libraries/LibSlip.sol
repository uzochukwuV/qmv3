// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/ITypes.sol";

/// @title LibSlip
/// @notice Slip settlement helpers deployed as an external library to keep the
///         main QuadraticMarket contract under the 24 576-byte Spurious Dragon limit.
///
/// All functions here are `public` — the compiler deploys them at their own
/// address and calls them via DELEGATECALL, so their bytecode does NOT count
/// toward the main contract's size budget.
library LibSlip {

    /// @notice Inspect all legs of a bet slip and classify its current state.
    ///
    ///   pending — at least one leg has not yet reached a terminal status
    ///             (not Settled, not Voided). Claim calls should revert.
    ///   won     — every leg settled on the bettor's chosen outcome. Full payout.
    ///   hasVoid — at least one leg's market was voided (cancelled).
    ///             V1 rule: triggers a full stake refund regardless of other legs.
    ///   hasLost — at least one leg settled on the wrong outcome. Slip is lost.
    ///
    /// Note: `won` is only true when !pending && !hasVoid && !hasLost.
    ///
    /// @param statuses       MarketStatus for each leg's market (index-aligned)
    /// @param winningOutcomes winningOutcome field for each leg's market
    /// @param legOutcomes    outcomeId the bettor chose on each leg
    /// @param numLegs        number of legs to inspect
    function checkSlipResult(
        MarketStatus[] memory statuses,
        uint8[]        memory winningOutcomes,
        uint8[]        memory legOutcomes,
        uint8 numLegs
    ) public pure returns (
        bool pending,
        bool won,
        bool hasVoid,
        bool hasLost
    ) {
        for (uint8 i = 0; i < numLegs; ) {
            MarketStatus s = statuses[i];

            if (s == MarketStatus.Voided) {
                hasVoid = true;
            } else if (s == MarketStatus.Settled) {
                if (winningOutcomes[i] != legOutcomes[i]) {
                    hasLost = true;
                }
            } else {
                pending = true;
            }
            unchecked { ++i; }
        }

        won = !pending && !hasVoid && !hasLost;
    }
}
