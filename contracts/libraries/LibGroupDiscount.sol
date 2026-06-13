// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/ITypes.sol";

/// @title LibGroupDiscount
/// @notice Computes the parlay correlation discount for multi-leg bet slips.
///
/// A MarketGroup represents a single real-world event (e.g. "Arsenal vs Chelsea").
/// Each market inside the group has a GroupType (FTR, Goals, BTTS, etc.).
///
/// When a bettor builds a multi-leg slip, legs within the same event are
/// correlated — betting "Arsenal Win" and "Arsenal -1 Asian Handicap" on the same
/// match is effectively the same bet twice. We apply a pairwise discount:
///
///   Same GroupType, same match  → 0.70× (7 000 bps) — heavily correlated
///   Diff GroupType, same match  → 0.92× (9 200 bps) — partially correlated
///   Different match             → 1.00× (10 000 bps) — independent, full odds
///
/// Total slip discount = product of all (n choose 2) pairwise discounts.
library LibGroupDiscount {

    uint256 private constant FULL_BPS        = 10_000;
    uint256 private constant SAME_TYPE_BPS   = 7_000;   // 0.70× same-group same-match
    uint256 private constant CROSS_TYPE_BPS  = 9_200;   // 0.92× cross-group same-match
    uint256 private constant DIFF_MATCH_BPS  = 10_000;  // 1.00× different match (no discount)

    /// @notice Pairwise multiplier between two slip legs (in BPS).
    /// @param typeA   GroupType of leg A
    /// @param typeB   GroupType of leg B
    /// @param sameMatch  True when both legs belong to the same MarketGroup (same real event)
    function pairwiseDiscount(
        GroupType typeA,
        GroupType typeB,
        bool sameMatch
    ) internal pure returns (uint256) {
        if (!sameMatch)                        return DIFF_MATCH_BPS;
        if (uint8(typeA) == uint8(typeB))      return SAME_TYPE_BPS;
        return CROSS_TYPE_BPS;
    }

    /// @notice Compute the composite slip discount multiplier (in BPS) for all legs.
    /// @param groupIds    MarketGroup ID for each leg (0 if market has no group)
    /// @param groupTypes  GroupType for each leg
    /// @param hasGroups   Whether each leg's market belongs to a group
    /// @param numLegs     Number of legs
    /// @return discountBps — multiply potentialPayout by this / BPS to apply discount
    ///                       Returns FULL_BPS (10 000) when there is only one leg.
    function computeSlipDiscountBps(
        uint64[] memory groupIds,
        GroupType[] memory groupTypes,
        bool[] memory hasGroups,
        uint8 numLegs
    ) internal pure returns (uint256 discountBps) {
        if (numLegs <= 1) return FULL_BPS;

        discountBps = FULL_BPS;

        for (uint8 i = 0; i < numLegs; ) {
            for (uint8 j = i + 1; j < numLegs; ) {
                bool sameMatch = (
                    hasGroups[i] &&
                    hasGroups[j] &&
                    groupIds[i] == groupIds[j]
                );
                uint256 pair = pairwiseDiscount(groupTypes[i], groupTypes[j], sameMatch);
                discountBps = (discountBps * pair) / FULL_BPS;

                unchecked { ++j; }
            }
            unchecked { ++i; }
        }
    }

    /// @notice Cross-match bonus: extra reward for parlaying across different events.
    ///         +1% per cross-match leg pair, capped at maxBonusBps.
    ///         Sportsbooks use this to incentivize accumulators spanning multiple matches.
    /// @param groupIds    MarketGroup ID per leg
    /// @param hasGroups   Whether each leg belongs to a group
    /// @param numLegs     Number of legs
    /// @param bonusPerPairBps  Bonus per independent cross-match pair (e.g. 100 = +1%)
    /// @param maxBonusBps      Cap on total bonus (e.g. 3 000 = +30%)
    function crossMatchBonusBps(
        uint64[] memory groupIds,
        bool[] memory hasGroups,
        uint8 numLegs,
        uint256 bonusPerPairBps,
        uint256 maxBonusBps
    ) internal pure returns (uint256 bonusBps) {
        if (numLegs <= 1) return 0;

        uint256 crossPairs = 0;

        for (uint8 i = 0; i < numLegs; ) {
            for (uint8 j = i + 1; j < numLegs; ) {
                bool sameMatch = (
                    hasGroups[i] &&
                    hasGroups[j] &&
                    groupIds[i] == groupIds[j]
                );
                if (!sameMatch) { unchecked { ++crossPairs; } }
                unchecked { ++j; }
            }
            unchecked { ++i; }
        }

        bonusBps = crossPairs * bonusPerPairBps;
        if (bonusBps > maxBonusBps) bonusBps = maxBonusBps;
    }
}
