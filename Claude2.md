# Architecture Note: Dynamic Fixed-Odds Sportsbook Model

Status: historical architecture note. The current contracts already implement much of this fixed-odds direction. Verify details against `contracts/` before treating this as current behavior.

## Summary

The proposed model is a decentralized sportsbook:

- AI or an off-chain pricing service proposes odds.
- Operators submit signed odds updates.
- LP liquidity backs payout obligations.
- Bettors receive familiar fixed odds.
- The protocol enforces exposure and deviation limits on-chain.

This is not an LMSR prediction-market design. It trades full pricing trustlessness for better sports-betting UX and clearer LP risk controls.

## Main Oracle Risks

### Slow Odds Updates

If external information changes and odds are not updated quickly, sharp bettors can hit stale prices. Operators need monitoring and market suspension procedures for lineup news, injuries, suspicious flow, and fast-moving external lines.

Useful mitigation:

- suspend the market during incidents
- reprice before reopening
- monitor `volumeFilled / volumeCap`
- use external consensus as the primary signal, not internal flow alone

### Gameable Flow-Based Pricing

If internal betting flow can move odds too much, users may manipulate one side to create mispricing elsewhere. Internal flow should only be a secondary input, bounded by deviation limits from external consensus.

### Captured Pricing Oracle

If the oracle can shade lines arbitrarily, bettors and LPs cannot audit fairness. The protocol should make oracle behavior reviewable by committing anchor odds and enforcing a maximum deviation on-chain.

## On-Chain Structure

The note recommends the same fixed-odds fields now present in `Market`:

- `currentOdds`
- `oddsAnchor`
- `maxDeviationBps`
- `volumeCap`
- `oddsLastUpdated`

The recommended instructions also exist in the Solidity design:

- `updateOdds(...)`
- `buyAtOdds(...)`

## LP Exposure Control

The core invariant is:

```text
total locked payout obligations <= LP deposit * max exposure multiplier
```

This is implemented through epoch locked-payout accounting and `maxExposureMultiplierBps`. Per-outcome `volumeCap` provides a second layer of control.

## Slip Multipliers

The note recommends static market-group relationships for accumulator pricing. The current code implements this with `GroupType`, `MarketGroup`, and `LibGroupDiscount`.

Expected behavior:

- correlated same-match legs reduce payout odds
- independent cross-match legs can receive a bounded bonus
- all slip odds are locked at placement

## Operational Implications

The protocol needs off-chain systems that are not yet represented by root docs or tests:

- odds source adapter
- oracle-signing service
- stale-line monitoring
- market suspension/reopen workflow
- LP risk reporting
- broader negative-path test coverage for signed odds payloads
