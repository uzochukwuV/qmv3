// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/ITypes.sol";
import "./LibOdds.sol";

/// @title StateSpacePricing9
/// @notice Stateless reference engine for the 9-state football book.
///         It is deployed separately so Core can stay under the contract-size limit.
contract StateSpacePricing9 {
    int256 internal constant WAD = 1e18;
    int256 internal constant LN2_WAD = 693147180559945309;
    uint8 internal constant N = 9;

    uint8 internal constant OUTCOME_HOME = 0;
    uint8 internal constant OUTCOME_AWAY = 1;
    uint8 internal constant OUTCOME_DRAW = 2;
    uint8 internal constant OUTCOME_OVER = 3;
    uint8 internal constant OUTCOME_UNDER = 4;
    uint8 internal constant OUTCOME_GG = 5;
    uint8 internal constant OUTCOME_NG = 6;

    function wmul(int256 x, int256 y) internal pure returns (int256) {
        return (x * y) / WAD;
    }

    function wdiv(int256 x, int256 y) internal pure returns (int256) {
        return (x * WAD) / y;
    }

    function exp(int256 x) internal pure returns (int256) {
        if (x == 0) return WAD;
        bool neg = x < 0;
        if (neg) x = -x;
        int256 k = x / LN2_WAD;
        int256 r = x - k * LN2_WAD;
        int256 term = WAD;
        int256 sum = WAD;
        for (uint256 i = 1; i <= 12; i++) {
            term = wmul(term, r) / int256(i);
            sum += term;
        }
        int256 result = sum;
        if (k > 0) {
            require(k < 64, "StateSpacePricing9: exp overflow");
            result = result << uint256(k);
        }
        return neg ? wdiv(WAD, result) : result;
    }

    function ln(int256 x) internal pure returns (int256) {
        require(x > 0, "StateSpacePricing9: ln domain");
        int256 k = 0;
        while (x >= 2 * WAD) {
            x = x / 2;
            k++;
        }
        while (x < WAD) {
            x = x * 2;
            k--;
        }
        int256 z = wdiv(x - WAD, x + WAD);
        int256 z2 = wmul(z, z);
        int256 term = z;
        int256 sum = z;
        for (uint256 i = 1; i <= 8; i++) {
            term = wmul(term, z2);
            sum += term / int256(2 * i + 1);
        }
        return k * LN2_WAD + 2 * sum;
    }

    function matchesOutcome(uint8 stateIndex, uint8 outcome) internal pure returns (bool) {
        if (outcome == OUTCOME_HOME) return stateIndex == 0 || stateIndex == 1 || stateIndex == 2;
        if (outcome == OUTCOME_AWAY) return stateIndex == 3 || stateIndex == 4 || stateIndex == 5;
        if (outcome == OUTCOME_DRAW) return stateIndex == 6 || stateIndex == 7 || stateIndex == 8;
        if (outcome == OUTCOME_OVER) return stateIndex == 0 || stateIndex == 2 || stateIndex == 3 || stateIndex == 5 || stateIndex == 8;
        if (outcome == OUTCOME_UNDER) return stateIndex == 1 || stateIndex == 4 || stateIndex == 6 || stateIndex == 7;
        if (outcome == OUTCOME_GG) return stateIndex == 0 || stateIndex == 3 || stateIndex == 6 || stateIndex == 8;
        if (outcome == OUTCOME_NG) return stateIndex == 1 || stateIndex == 2 || stateIndex == 4 || stateIndex == 5 || stateIndex == 7;
        revert("StateSpacePricing9: bad outcome");
    }

    /// @notice Seed the group book from a precomputed state prior.
    function seedStateQ(uint256[9] calldata stateProbabilitiesWad, uint256 bWad) external pure returns (int256[9] memory q) {
        require(bWad > 0, "StateSpacePricing9: b=0");
        for (uint8 s = 0; s < N; ) {
            require(stateProbabilitiesWad[s] > 0, "StateSpacePricing9: zero prob");
            q[s] = wmul(int256(bWad), ln(int256(stateProbabilitiesWad[s])));
            unchecked { ++s; }
        }
    }

    function _maxQ(int256[9] memory q) internal pure returns (int256 m) {
        m = q[0];
        for (uint8 s = 1; s < N; ) {
            if (q[s] > m) m = q[s];
            unchecked { ++s; }
        }
    }

    function _probabilities(int256[9] memory q, uint256 bWad) internal pure returns (uint256[9] memory p) {
        int256 b = int256(bWad);
        int256 m = _maxQ(q);
        int256 sumExp = 0;
        int256[9] memory exps;
        for (uint8 s = 0; s < N; ) {
            exps[s] = exp(wdiv(q[s] - m, b));
            sumExp += exps[s];
            unchecked { ++s; }
        }
        for (uint8 s = 0; s < N; ) {
            p[s] = uint256(wdiv(exps[s], sumExp));
            unchecked { ++s; }
        }
    }

    function outcomeOdds(int256[9] calldata q, uint256 bWad, uint8 outcome) external pure returns (uint256) {
        int256[9] memory qm = q;
        uint256[9] memory p = _probabilities(qm, bWad);
        uint256 total;
        for (uint8 s = 0; s < N; ) {
            if (matchesOutcome(s, outcome)) total += p[s];
            unchecked { ++s; }
        }
        require(total > 0, "StateSpacePricing9: zero probability");
        uint256 odds = (ODDS_PRECISION * uint256(WAD)) / total;
        return odds < LibOdds.MIN_ODDS ? LibOdds.MIN_ODDS : odds;
    }
}
