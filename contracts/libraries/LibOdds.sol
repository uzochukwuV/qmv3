// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../interfaces/ITypes.sol";

/// @title LibOdds
/// @notice Fixed-odds math helpers. Replaces the entire LMSR engine (lmsr.rs,
///         exp_ln.rs, fixed_point.rs) with straightforward decimal-odds arithmetic.
///
/// Odds representation: decimal odds × ODDS_PRECISION (1_000_000).
///   Odds of 2.80  → stored as 2_800_000
///   Odds of 1.50  → stored as 1_500_000
///   Minimum valid → 1_010_000 (1.01×, i.e. near-certainty)
///
/// Payout formula (single leg):
///   payout = stake × odds / ODDS_PRECISION
///
/// Combined parlay odds:
///   combinedOdds = leg1.odds × leg2.odds × ... / ODDS_PRECISION^(n-1)
library LibOdds {

    uint256 public constant MIN_ODDS = 1_010_000;   // 1.01 — absolute floor
    uint256 public constant EVENS    = 2_000_000;   // 2.00 — even money

    // ─── Payout calculations ───────────────────────────────────────────────────

    /// @notice Compute gross payout for a single-leg bet.
    ///         Returns the total return (stake included), not profit.
    ///         e.g. stake=100, odds=2_800_000 → payout=280
    function computePayout(
        uint256 stake,
        uint256 odds
    ) internal pure returns (uint256) {
        require(odds >= MIN_ODDS, "LibOdds: odds below minimum");
        require(stake > 0, "LibOdds: zero stake");
        return (stake * odds) / ODDS_PRECISION;
    }

    /// @notice Compute combined decimal odds for a multi-leg accumulator.
    ///         Result is in ODDS_PRECISION units.
    ///         e.g. [2_800_000, 1_500_000] → 4_200_000 (4.20×)
    function combinedOdds(
        uint256[] memory oddsArr
    ) internal pure returns (uint256 result) {
        uint256 len = oddsArr.length;
        require(len > 0, "LibOdds: empty odds array");

        result = ODDS_PRECISION; // start at 1.00
        for (uint256 i = 0; i < len; ) {
            require(oddsArr[i] >= MIN_ODDS, "LibOdds: leg odds below minimum");
            result = (result * oddsArr[i]) / ODDS_PRECISION;
            unchecked { ++i; }
        }
    }

    /// @notice Apply house margin to raw odds.
    ///         After margin, odds = odds × (BPS - marginBps) / BPS.
    ///         e.g. odds=2_800_000, margin=500bps(5%) → 2_660_000 (2.66×)
    function applyMargin(
        uint256 odds,
        uint256 marginBps
    ) internal pure returns (uint256) {
        require(marginBps < BPS, "LibOdds: margin >= 100%");
        return (odds * (BPS - marginBps)) / BPS;
    }

    /// @notice Apply a discount multiplier (in BPS) to combined odds.
    ///         Used for same-match parlay correlation discounts.
    function applyDiscount(
        uint256 odds,
        uint256 discountBps
    ) internal pure returns (uint256) {
        require(discountBps <= BPS, "LibOdds: discount > 100%");
        return (odds * discountBps) / BPS;
    }

    // ─── Oracle deviation check ────────────────────────────────────────────────

    /// @notice Validate that new oracle odds are within maxDeviationBps of the anchor.
    ///         anchor = odds committed at market creation (from Pinnacle / The Odds API).
    ///         This is the on-chain guarantee that the AI oracle can't shade lines arbitrarily.
    /// @param newOdds        Proposed new odds (× ODDS_PRECISION)
    /// @param anchor         Anchor odds set at market creation (× ODDS_PRECISION)
    /// @param maxDeviationBps  Max allowed drift from anchor in basis points
    /// @return valid  True when the proposed odds are within tolerance
    function withinDeviation(
        uint256 newOdds,
        uint256 anchor,
        uint256 maxDeviationBps
    ) internal pure returns (bool valid) {
        if (maxDeviationBps == 0 || anchor == 0) return true;
        uint256 diff = newOdds > anchor ? newOdds - anchor : anchor - newOdds;
        uint256 deviationBps = (diff * BPS) / anchor;
        return deviationBps <= maxDeviationBps;
    }

    // ─── Volume cap helpers ────────────────────────────────────────────────────

    /// @notice Check whether accepting a bet would breach the per-outcome volume cap.
    ///         volumeCap limits LP payout obligation per outcome.
    /// @param volumeFilled  Current payout liability already locked for this outcome
    /// @param volumeCap     Maximum payout liability for this outcome
    /// @param newPayout     Additional payout to be locked if this bet is accepted
    /// @return canAccept  True when the bet fits within the cap
    function withinVolumeCap(
        uint256 volumeFilled,
        uint256 volumeCap,
        uint256 newPayout
    ) internal pure returns (bool canAccept) {
        if (volumeCap == 0) return true; // 0 means uncapped
        return (volumeFilled + newPayout) <= volumeCap;
    }

    // ─── LP exposure multiplier ────────────────────────────────────────────────

    /// @notice Compute the maximum allowed total payout obligation for an epoch.
    ///         max_locked_payouts = lpDeposit × maxExposureMultiplierBps / BPS
    ///         e.g. lpDeposit=1_000_000, multiplierBps=15_000(1.5×) → 1_500_000
    function maxEpochExposure(
        uint256 lpDeposit,
        uint256 maxExposureMultiplierBps
    ) internal pure returns (uint256) {
        return (lpDeposit * maxExposureMultiplierBps) / BPS;
    }
}
