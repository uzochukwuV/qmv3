# Architecture Note: Static Odds, LP Voting, And Challenge Windows

Status: historical architecture note. Some recommendations here were superseded by the current Solidity implementation. Treat this as design context, not active instructions.

## Original Proposal

This note analyzed a more static sportsbook model:

- AI proposes odds before markets go live.
- LPs vote on markets or categories before the epoch.
- Proposed odds have a challenge window before activation.
- LP deposits determine total tradable exposure in the epoch.
- Static `GroupType` relationships drive slip multipliers.

## What The Model Gets Right

- Fixed odds are easier for bettors to understand than LMSR prices.
- LP-backed volume caps are easier to explain than AMM inventory risk.
- Static market groups are a practical replacement for complex same-game parlay math.
- Cross-match versus same-match slip treatment matches sportsbook intuition.

## Critical Risks

### Stale Odds

Fully static odds can become wrong before kickoff. Sports pricing changes quickly when lineups, injuries, weather, or market consensus changes. The current contract design allows pre-start `updateOdds()` and `suspendMarket()`/`resumeMarket()` to reduce this risk.

### Insolvency Without Hard Caps

LP deposits do not automatically bound payouts. A market can owe more than the stake collected. The protocol must cap payout liability through per-outcome volume caps and epoch-level exposure checks.

### Oracle Trust

Pricing oracle trust is broader than settlement oracle trust. The current design mitigates this with signed anchor odds and `maxDeviationBps`, but the off-chain source and signing policy still need operational documentation.

### Volume Allocation

Total epoch liquidity must be allocated across markets and outcomes. Equal allocation is too blunt, while first-come-first-served liquidity can starve later markets. The current code has automatic volume-cap behavior, but production policy still needs design and tests.

### LP Governance Limits

LPs may not have enough sports expertise to approve individual odds. Category voting is simpler than market-by-market voting and is reflected in `voteCategory()`.

## Current Implementation Alignment

The code now keeps these ideas:

- `SportCategory` and LP category voting
- static `GroupType` enum
- fixed decimal odds
- oracle-signed market creation and odds updates
- exposure multiplier and payout locking
- per-outcome volume caps
- same-match discount and cross-match bonus

The code does not currently implement a 24-hour LP challenge window for odds before market activation. Result settlement has a challenge window.

## Recommended Next Steps

- Broaden tests before changing the risk model further.
- Define production policy for odds sources and allowed deviations.
- Decide whether LP voting should remain category-only or evolve into market/risk-parameter voting.
- Add a QuadraticMarket Ignition deployment module.
