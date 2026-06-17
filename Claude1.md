# Architecture Note: Semi-Static Fixed Odds Over LMSR

Status: historical architecture note. The current Solidity implementation has already pivoted to semi-static fixed odds. Verify all claims here against `contracts/` before using this as implementation guidance.

## Core Position

Sports markets do not need LMSR-style price discovery in the same way open-ended prediction markets do. Major sporting events already have strong external probability signals from bookmakers, exchanges, and data providers before any bet is placed on this protocol.

The practical value proposition is therefore:

- decentralize custody and LP participation
- make pricing and settlement auditable
- capture bookmaker-style margin for LPs
- preserve a familiar fixed-odds UX for bettors

This led to the fixed-odds design now visible in the contracts:

- `currentOdds`
- `oddsAnchor`
- `maxDeviationBps`
- `volumeCap`
- `buyAtOdds()`
- `updateOdds()`

## Tradeoff

LMSR is more trustless because prices emerge from flow. Semi-static fixed odds are more usable for sports betting but rely on an odds oracle. That oracle risk must be constrained by on-chain commitments and external benchmarks.

Required mitigations:

- commit anchor odds at market creation
- enforce `maxDeviationBps` on-chain
- publish or document the external source used for anchor odds
- use `minOdds` on bet placement to protect users from slippage/front-running
- update or suspend markets quickly when external information changes

## LP Risk Model

LPs are effectively underwriting fixed-odds payout obligations. The protocol must cap risk explicitly.

Important controls:

- per-outcome `volumeCap`
- per-market or group exposure controls
- epoch-level `maxExposureMultiplierBps`
- locked-payout accounting
- clear LP reporting around expected yield, drawdown, and worst-case exposure

Example: with a 1.5x epoch exposure multiplier, a 1,000,000 USDC epoch can lock at most 1,500,000 USDC of gross payout obligations. That still permits material LP loss, so docs and UI should describe this as sportsbook underwriting risk, not passive DeFi yield.

## Parlay / Slip Model

The note recommends replacing complex same-game parlay state modeling with static market-group logic. The current implementation follows this idea through:

- `GroupType`
- `MarketGroup`
- `LibGroupDiscount.pairwiseDiscount()`
- `LibGroupDiscount.computeSlipDiscountBps()`
- `LibGroupDiscount.crossMatchBonusBps()`

The high-level rule:

- same match, same market type: heavy discount
- same match, different market type: moderate discount
- different match: no discount, optional cross-match bonus

## Implementation Direction Captured By Current Code

The Solidity contracts now reflect the semi-static direction:

- `LibOdds` replaces LMSR math with decimal-odds arithmetic.
- `CreateMarketParams` requires oracle-signed anchor odds.
- `updateOdds()` validates signed odds updates against anchor deviation.
- `buyAtOdds()` computes payout directly from stake and current odds.
- `placeSlip()` locks leg odds and applies house margin, same-match discount, and cross-match bonus.

## Current Follow-Up Work

- Broaden protocol tests beyond the happy-path lifecycle.
- Document operational requirements for the odds oracle and market suspension process.
