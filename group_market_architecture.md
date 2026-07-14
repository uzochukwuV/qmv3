# Group Market Architecture

**Status:** Design draft — supersedes the per-market LMSR model in favor of a
group-level, state-space-derived pricing and settlement model.

**Scope:** A "market group" is one real-world event (one football match) split
into exactly three correlated markets: **1x2** (Home/Draw/Away),
**Over/Under 2.5**, and **GG/NG** (both teams to score). This document covers
how odds are seeded, how they move as bets come in, how LP risk is bounded and
segregated, how all three markets settle from a single result, and how
multi-leg bet slips are built on top without reintroducing the stack-depth or
accounting bugs the original per-market design hit.

---

## 1. Why this redesign exists

The original design priced each of the 3 markets in a group independently
(separate LMSR curve per market), backed by one shared LP treasury, and
settled each market with its own oracle submission. Three problems fell out
of that:

1. **No consistency guarantee across markets.** Nothing forced the 1x2,
   O/U, and GG/NG odds — or their settlement outcomes — to correspond to the
   same underlying match. A whale could construct a cross-market position
   that's inconsistent with any real scoreline, and the protocol had no way
   to detect it.
2. **LP capital was commingled** across markets and epochs in one
   `treasury_base_ata`, while only a subset of liabilities
   (`config.locked_payouts`) were subtracted from free liquidity. Seed
   capital, per-market `locked_payout`, and epoch boundaries didn't reconcile
   in the withdrawal-gating math (`free_liquidity()`), creating a solvency
   gap between what LPs could withdraw and what was actually unencumbered.
3. **Settlement required N independent oracle submissions per group** (one
   per market), multiplying operator overhead, dispute-window surface, and
   the risk of inconsistent finalization across markets that all describe
   one match.

Everything below fixes these by deriving all three markets — pricing *and*
settlement — from a single shared representation of "what actually happened
in the match," instead of treating them as three unrelated markets that
happen to share a fixture.

---

## 2. The state space: minimal sufficient buckets, not scorelines

### 2.1 Why not model every scoreline

The obvious way to make three markets consistent is to model the joint
distribution over exact scorelines (0-0, 1-0, 2-1, ...) and derive each
market's odds by summing over the scorelines consistent with each outcome.
This works, but it's far more resolution than the protocol needs: a grid
covering 0-7 goals per side is 64 states, each of which must be iterated on
every trade (recomputing the LMSR cost function requires summing
`exp(q_s/b)` over every state). That's 62% more compute than necessary for
what these three specific markets actually require, purely to represent
scoreline detail no market in the group prices.

### 2.2 The minimal sufficient state space

Since the group only ever contains these three markets, the only
distinctions that matter are: which side won (or draw), whether total goals
were over/under 2.5, and whether both teams scored. That's a
`(1x2) x (O/U) x (GG/NG)` composite space — **12 theoretical combinations**.

Three of those twelve are **structurally impossible**, not merely
low-probability:

| Combination | Why it's impossible |
|---|---|
| Home win + Under 2.5 + GG | Requires `h > a`, `h + a < 3`, `h ≥ 1`, `a ≥ 1`. No integer scoreline satisfies all four simultaneously (the smallest home-win-with-both-scoring total is already ≥ 3). |
| Away win + Under 2.5 + GG | Same constraint, mirrored. |
| Draw + Over 2.5 + NG | A draw with NG requires both teams on equal, non-scoring... i.e. `h = a` and (`h=0` or `a=0`) forces `h = a = 0`, which is Under, not Over. |

This leaves **exactly 9 feasible composite states**. This is not a lossy
approximation — it is the exact sufficient statistic for pricing these three
markets. No correlation information relevant to the product is discarded;
only resolution that no market in the group ever queries is dropped.

**Reference implementation:** `StateSpaceLMSR_9state.sol` (EVM
proof-of-concept, not the on-chain program) — compiled, deployed to a local
EVM, and gas-profiled. A trade against the 9-state space costs **236,256
gas** vs **624,554 gas** against a 25-state scoreline grid (5x5 goal grid) —
a 62% reduction, with results matching an independent Python model to the
decimal place.

### 2.3 Mapping onto existing on-chain structures

`MarketGroup` already carries `outcome_state_masks[market_index][outcome_id]`
and `state_probabilities` — this table should be re-scoped to exactly 9 rows
instead of a scoreline-sized grid. The mask logic (`math/correlation.rs`)
that currently exists for same-game-parlay pricing becomes the same
machinery used for live rebalancing (§4) and settlement derivation (§6) —
one table serves three purposes instead of three separate ad hoc structures.

---

## 3. Odds seeding: from backend feed to initial state distribution

### 3.1 Why not start at flat/uniform odds

Decimal odds of 1.0 imply 100% probability and zero payout — a degenerate
starting point, not a neutral one. Markets must open already reflecting a
real prior, sourced from the backend's odds feed (sportsbook data provider),
not from an arbitrary uniform distribution over 9 states.

### 3.2 The seeding problem: 4 known numbers, 8 degrees of freedom

The backend feed gives exactly **4 independent numbers**: 1x2 has 3 outcomes
summing to 1 (2 free values), O/U has 1 free value, GG/NG has 1 free value.
The 9-state distribution has **8 degrees of freedom** (9 probabilities
summing to 1). The marginals alone under-determine the joint distribution —
a correlation *model* is required to fill in the remaining structure, then
calibrated so its marginals match the feed as closely as possible.

### 3.3 Seeding pipeline

1. **Strip the vig.** Backend odds carry the source book's own margin
   (overround). Convert decimal odds to implied probabilities
   (`1/odds`), sum them per market to get the overround, divide through to
   get "true" probabilities. Example measured overrounds: 1x2 ≈ 4.8%,
   O/U ≈ 5.3%, GG/NG ≈ 5.3%. Do not seed the protocol's own book with
   someone else's margin baked in — the protocol's margin should come
   exclusively from `buy_fee_bps`, applied once, deliberately.
2. **Fit a bivariate scoreline model to the true marginals.** A Dixon-Coles
   adjusted bivariate Poisson (two team-strength parameters `λ_home`,
   `λ_away`, plus a low-score correlation term `ρ`) is fit via least squares
   against the 4 known target probabilities. In the worked example
   (Home 2.10 / Draw 3.40 / Away 3.60, O/U 1.90/1.90, GG/NG 1.85/1.95):
   fitted `λ_home=1.514`, `λ_away=1.100`, `ρ=-0.077`, recovering marginals
   within ~1-1.5 percentage points of target. Exact recovery isn't always
   possible (3 free parameters chasing 4 constraints) — this residual is
   expected and acceptable.
3. **Aggregate the fitted scoreline distribution into the 9 buckets** from
   §2.2, giving `p_bucket` for each of the 9 states.
4. **Seed `q_s = b · ln(p_bucket_s)`.** Since the LMSR softmax is shift
   invariant, this directly reproduces the target distribution at market
   open — no iterative calibration needed once `p_bucket` and `b` are known.

### 3.4 Sizing `b` from the group's capital allocation

See §5 for the full per-group pool design. In short: `b` is chosen so the
LMSR's worst-case loss bound (`b · ln(9)`) is a safe fraction — not all —
of the capital allocated to that specific group, leaving headroom for fees
and any slip-bonus liability sharing the same vault.

```
b = (group_pool_cap * safety_fraction) / ln(9)
```

Worked example: `$30,000` cap, `0.85` safety fraction → `b ≈ 11,606`,
worst-case loss `≈ $25,500` (85% of cap, 15% buffer retained).

---

## 4. Live rebalancing: group-level combinatorial LMSR

### 4.1 Mechanism

Every trade is a purchase of an **Arrow-Debreu bundle**: buying `x` shares
of an outcome (e.g. "Home Win") adds `x` to `q_s` for every one of the 9
states consistent with that outcome (per Hanson's 2003 combinatorial market
scoring rule construction). The cost is the standard LMSR cost function
evaluated before and after:

```
C(q) = b * ln( Σ_s exp(q_s / b) )
cost_of_trade = C(q_after) - C(q_before)
```

Each market's live odds are simply a different partition (sum) over the same
9-state distribution:

```
P(outcome O) = Σ_{s ∈ O} exp(q_s/b) / Σ_s exp(q_s/b)
```

Because all three markets are marginals of one distribution, **there is no
way to construct a cross-market position that's inconsistent with the
underlying probabilities** — this is what removes the arbitrage risk that a
hand-tuned "if home win buys, nudge GG down by X%" rule set would have left
open.

### 4.2 Verified behavior

Simulated and deployed on-chain (EVM reference implementation). A $2,000
buy on Home Win against a $500k-pool-calibrated book moved:

| Market | Before | After |
|---|---|---|
| Home | 46.5% | 52.1% |
| Draw | 25.2% | 22.6% |
| Away | 28.2% | 25.3% |
| Over 2.5 | 50.6% | 51.6% |
| GG | 53.8% | 53.1% |

Direction matches intuition (home win up → draw/away down, over up, GG
slightly down), but magnitude on the secondary markets is smaller than a
naive hand-tuned rule would likely have set — because "home win" states span
the *whole* range of scorelines, so boosting them proportionally doesn't
skew total-goals or both-scored distribution as much as it skews the
head-to-head split. This is the model correctly respecting actual
statistical correlation rather than an assumption about it.

### 4.3 Risk control: `b` must scale with exposure cap, not be fixed

A too-small `b` lets a single large trade nearly saturate an outcome (one
test run: $40k against a $20.8k worst-case-loss book pushed Home Win to
99.98%). `b` must be derived from `max_group_exposure` /
the group's allocated pool at group-creation time (§3.4), never a global
constant shared across groups of different size/popularity.

---

## 5. LP risk segregation: per-group capped vaults

### 5.1 The commingling bug this replaces

Previously, seed capital and LP capital shared one `treasury_base_ata`
across all markets and epochs, while `free_liquidity()` only subtracted
`config.locked_payouts` (a fee-pool reservation) — not the aggregate of
every market's `locked_payout` (redemption liability). This meant LP
withdrawals could be priced against capital that was already backing
unsettled seed positions or unclaimed winner payouts elsewhere in the
system.

### 5.2 The fix: dedicated, capped, per-group vaults

Instead of one shared pool with ledger-based accounting that has to stay
perfectly synchronized forever, each market group gets its own PDA-owned
vault, funded only up to its allocated cap:

- LPs who opt into a given epoch/group deposit into **that group's vault
  only** — never a shared pot.
- The vault backs **only that group's** LMSR opening exposure
  (`b · ln(9)` worst-case) plus any slip-bonus liability attributed to slips
  containing legs from that group.
- At group settlement, vault balance (seed capital ± net LMSR result ±
  fees) distributes pro-rata to that group's opted-in LPs — no cross-group
  or cross-epoch accounting to keep in sync.
- The group's pool cap (e.g. "$30k for this match") is a hard ceiling
  the backend chooses per group (likely a function of expected match
  volume/popularity), from which `b` is derived (§3.4).

This is a structural fix rather than a ledger-discipline fix: solvency is
guaranteed by fund segregation, not by an accounting invariant that must be
maintained correctly across every future code path that touches
`locked_payout`.

---

## 6. Group settlement: one result, derived outcomes

### 6.1 The problem with per-market settlement

Settling 1x2, O/U 2.5, and GG/NG independently means 3 separate oracle
submissions, 3 separate dispute windows, and — critically — **no on-chain
guarantee that the three finalized outcomes are even mutually consistent**
(nothing stops a 1x2 result and a GG/NG result from implying a scoreline
that doesn't exist). Layering a staked, multi-operator quorum (§7) on top
multiplies this: 3 markets × 2-3 operator attestations = up to 9 signed
attestations for one match, all describing the same underlying fact.

### 6.2 The fix: settle the match once, derive every market

1. **`propose_group_result`** — operator(s) submit the match's terminal
   state — one of the 9 buckets from §2.2, not a per-market outcome —
   against a `GroupDispute` PDA (`seeds = [DISPUTE, group_id]`). This is
   where the staked multi-operator quorum logic (§7) lives; it runs once
   per group, not once per market.
2. **`finalize_group_result`** — after quorum/challenge window, a
   permissionless call reads the confirmed bucket, then for each market in
   the group looks up `outcome_state_masks[market_index]` to determine
   which outcome that bucket satisfies, and writes
   `market.winning_outcome` + `market.status = Settled` for all markets in
   the group from a single confirmed fact.
3. Existing per-market settlement bookkeeping (`locked_payout` release,
   epoch settlement counters) is unchanged — it's invoked once per market
   from the group finalizer instead of from independent oracle submissions.

This makes cross-market consistency a structural guarantee rather than an
operator-honesty assumption, and cuts operator overhead by roughly 3x per
match.

---

## 7. Staked multi-operator settlement

Settlement operators stake collateral and must reach a quorum (2-3
acceptances) submitting the same result (with a supporting odds-API
transaction hash as evidence) before a group's result finalizes. This
quorum check is the sole content of `propose_group_result` (§6.2) — it now
runs once per match rather than once per market, and a `GroupDispute`
replaces what would otherwise have been three-to-five independent `Dispute`
PDAs.

Design requirements carried over from the per-market design:
- **Permissionless finalization** — anyone can call `finalize_group_result`
  once quorum/challenge-window conditions are met; the system must not
  depend on any specific operator or bot being online.
- **Slashing on dispute-confirmed dishonesty** — an operator whose
  submitted result is successfully challenged and overturned should lose
  stake, funding the disputer and/or the group's vault.
- **Oracle key rotation risk** (carried over from the admin.rs review):
  the set of eligible operators and the parameters governing quorum size
  should not be instantly, silently swappable by a single admin key without
  event emission — this is a governance surface, not just a settlement
  mechanic.

---

## 8. Bet slips: individually-executed legs under one PDA

### 8.1 Why individual execution, not a single multi-leg instruction

The original multi-leg slip design failed because cramming N legs' worth of
accounts (market, outcome mint, ATAs, dispute PDAs) into one instruction's
`Accounts` struct, plus looping CPI calls inside one handler, overflows the
BPF stack — this compounds linearly with leg count on top of a per-market
account footprint that already needed boxing to fit one market. Executing
each leg as its own transaction, with the same account footprint as an
ordinary single bet, avoids the limit entirely rather than working around
it.

### 8.2 Flow

1. **`place_slip_await`** — user sends stake and their desired markets to
   the backend. A `Slip` PDA (`seeds = [SLIP, user, slip_id]`) opens,
   tracking `num_legs`, `num_legs_settled`, `num_legs_won`, `stake`,
   `bonus_bps`, `bonus_liability`, `status`. Stake is escrowed into a
   PDA-owned base ATA.
2. **Backend executes each leg as an individual transaction**, buying into
   each market with the `Slip` PDA as position holder (not the user
   directly), using `MarketMode::FixedOdds` (§8.3) rather than raw LMSR
   pricing.
3. **`settle_slip_leg`** (permissionless, per market) — once a market
   settles, reads `winning_outcome`, redeems the PDA's outcome tokens 1:1
   into the PDA's base ATA if won, increments `Slip.num_legs_settled` (and
   `num_legs_won` if it won). This reuses existing `claim_payout` redemption
   logic with the PDA as signer via program seeds.
4. **`resolve_slip`** (permissionless) — once
   `num_legs_settled == num_legs`, checks `num_legs_won == num_legs`
   **on-chain, deterministically** — this must not be a bot/backend
   decision. If all legs won: release reserved `bonus_liability` from the
   group vault(s), pay it into the PDA, user claims the full PDA balance.
   If any leg lost: release `bonus_liability` back to vault free liquidity,
   PDA's residual (winning-leg redemptions from a losing slip) sweeps to
   the vault.

### 8.3 Why fixed odds for slip legs, not raw LMSR

Locking each leg's price at slip-construction time (via `FixedOdds` mode)
avoids two problems: (a) odds staleness/slippage while the backend
sequentially executes N legs, and (b) LP over-exposure to a single large
bettor moving group odds mid-slip-construction. The group-level LMSR (§4)
still runs continuously in the background and is what the *next* quote
reflects — slips just snapshot rather than float.

### 8.4 Required guardrails

- **Cancellation/timeout path.** If a leg fails mid-execution (market
  suspended, price moved past tolerance), a `cancel_slip` instruction with
  a deadline must refund whatever legs did execute — otherwise stake can
  get stuck in a half-built slip.
- **No duplicate markets within one slip** — prevents splitting one bet
  into a slip against itself purely to farm bonus tiers without genuine
  correlated risk.

---

## 9. Slip bonus structure

Modeled as a parlay/accumulator boost: extra payout on top of summed leg
payouts, paid only if every leg wins, reserved as a liability from the
moment the slip is created rather than decided at resolution time.

1. **Tiered, bounded, on-chain config** (`SlipBonusConfig`): a small table
   of `(min_legs, bonus_bps)` pairs, admin-updatable but bounds-checked
   (monotonic in legs, capped at a `MAX_SLIP_BONUS_BPS` regardless of leg
   count) — this is a direct LP liability, so it inherits the same
   bounds-checking discipline flagged as missing elsewhere in `admin.rs`.
2. **Liability locked at slip creation**, not payout: at
   `place_slip_await`, `bonus_liability = combined_payout * bonus_bps /
   10_000` is computed and reserved against the relevant group vault(s)'
   free-liquidity counter — protecting LP from the moment the slip exists,
   not just at resolution.
3. **Deterministic release at `resolve_slip`** (§8.2, step 4) — no separate
   mechanism, just two additional branches in logic that already exists.
4. **Per-epoch/per-group aggregate bonus-exposure cap**, mirroring the
   existing `max_market_exposure` pattern in `trade.rs`, bounding total
   reserved bonus liability independent of how many individual slips
   contribute to it.

---

## 10. Governance surfaces this design depends on

The mechanisms above lean on `admin.rs` more than the original per-market
design did (group creation parameters, `b`/pool-cap sizing, operator set,
bonus config) — which makes the following, flagged separately during
review, more consequential than before rather than less:

- **Two-step admin transfer** (propose/accept) instead of single-shot, since
  admin now indirectly controls per-group risk sizing.
- **Bounds checks** on `max_market_exposure`, `min_outcome_price_bps`,
  and any new `lmsr_default_b` / group-pool-cap parameters — currently
  absent for several of these.
- **Event emission** (`ConfigUpdated`, `OperatorAdded/Removed`,
  `GroupSettled`) — currently none of `admin.rs`'s state changes emit
  events, leaving off-chain indexers to poll rather than react.
- **Oracle/operator-set rotation** should not be instantly, silently
  swappable given operators now settle whole groups rather than single
  markets.

---

## 11. Open items

- Finalize the on-chain fixed-point `exp`/`ln` approach for Anchor —
  the EVM reference implementation uses a demo-grade Taylor series;
  Solana's compute budget likely favors a lookup-table or piecewise-linear
  approximation instead, especially once trades iterate over 9 states plus
  overhead per instruction.
- Formalize compute-unit budgeting for a 9-state cost-function evaluation
  per trade under Anchor's constraints (distinct from EVM gas, needs its
  own measurement).
- Decide the parametric family for odds-seeding beyond Dixon-Coles if a
  tighter marginal fit is needed (more free parameters vs. more backend
  compute per group creation).
- Specify `cancel_slip` deadline and refund mechanics precisely (§8.4).
- Decide slashing mechanics and destination (disputer reward vs. group
  vault) for the staked operator quorum (§7).
