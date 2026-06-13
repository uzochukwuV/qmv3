Discarding built system is not the issue , the issue is what works, we can make it semi static where we tell bettors that the odds are subjected to change and ai can keep on analysing the match and user better behaviour to change odds to minimize loss
Now this is a genuinely interesting middle ground. Let me think through it properly.Here's the full picture.

---

## What you're actually describing already exists — it's called a sportsbook

And that's not a criticism. Every real bookmaker — Bet365, Pinnacle, DraftKings — does exactly this: AI or traders propose odds, odds update as information arrives, volume is capped by the book's capital, LP (the bookmaker) absorbs the net P&L. You're not inventing a new model. You're decentralizing an existing one. That's the right move. The insight is correct.

---

## The only serious risk is the AI as pricing oracle

Everything else in this model is solved, standard practice. The one thing that creates genuine protocol risk is that you've replaced LMSR's trustless self-pricing with an AI backend that you control.

Three scenarios matter:

**Scenario 1 — AI is honest but slow.** Arsenal's starting lineup drops 90 minutes before kickoff. AI hasn't updated yet. Sharp bettors know about it from Twitter and hammer Arsenal at stale odds. LP gets wrecked before the update. The fix is standard bookmaker practice: set a maximum time between odds reviews, and when AI detects anomalous flow concentration on one outcome, it flags for immediate re-pricing. Internally this is just a threshold: if `volume_filled[i] / volume_cap[i] > 0.40` within 2 hours of match start, trigger re-price.

**Scenario 2 — AI is gamed.** Users discover that betting heavily on outcome A causes the AI to shorten A's odds, which inflates B. They bet small on A, wait for AI to tighten A, then hammer B at now-inflated odds. The fix: AI must use external consensus (The Odds API, Pinnacle) as its primary signal, not internal flow alone. Internal flow is a secondary adjustment signal, capped at ±10% deviation from external consensus. This is stored on-chain as `max_deviation_bps` on the Market account — an actual on-chain guarantee users can verify.

**Scenario 3 — AI is captured by you.** You systematically set odds 3% worse than fair. LPs don't notice individual markets, only aggregate P&L at epoch end. No on-chain proof. The fix is the same as Scenario 2: commit the odds source on-chain. If you declare "odds within 500 bps of Pinnacle at time of bet," that's verifiable. Your AI can only deviate within the declared tolerance. This is your trust mechanism — publish the benchmark, commit the deviation limit, let anyone audit.

---

## The on-chain structure

The Market account needs four additions and a replacement:

```
current_odds: [u64; MAX_OUTCOMES]      // what bettors see, Q32.32
odds_anchor: [u64; MAX_OUTCOMES]       // Pinnacle/consensus at creation  
max_deviation_bps: u64                 // on-chain guarantee
volume_cap: [u64; MAX_OUTCOMES]        // per-outcome cap from LP deposit
odds_last_updated: i64                 // timestamp
```

`q_values` goes away. `lmsr_b` goes away. All the math in `math/lmsr.rs` goes away.

Two new instructions:

`update_odds(outcome_odds: Vec<u64>)`: Oracle-signed. Validates new odds are within `max_deviation_bps` of `odds_anchor`. Only callable while `now < market.start_time` and `status == Open`. Emits `OddsUpdated` event for frontend real-time display. About 20 lines of handler code.

`buy_at_odds(outcome_id, amount, min_odds)`: Replaces `buy_shares`. No LMSR computation. Just: `payout = amount × current_odds[outcome_id] / SCALE`, check volume cap, lock payout, mint outcome token. `min_odds` is the user's slippage floor — if odds moved against them since they loaded the page, tx reverts. This is cleaner than max_payment because users think in odds not in cost.

---

## LP risk: the exposure multiplier cap is mandatory

Without this, the model can't launch safely. The logic is simple:

```
max_locked_payouts_across_all_markets <= LP_deposit × max_exposure_multiplier
```

Set `max_exposure_multiplier` at epoch initialization (e.g., 1.5x). LP deposits $1M, maximum payout obligation is $1.5M. Worst epoch: everything wins, LP loses $500K (50% drawdown). Best epoch: everything loses, LP keeps all $1M+ in stakes collected.

Expected value with a 5% house margin baked into odds: +5% of total volume. At $10M volume per epoch, LP earns ~$500K on $1M deposit. 50% APY expected, with variance. That's the pitch to LPs — high expected yield, bounded downside.

The key thing to communicate to LPs: this is writing covered options on sports outcomes, not Uniswap LP. The risk profile is fundamentally different from DeFi yield farming. LPs who understand sports betting and volatility are your target — not passive yield seekers.

---

## Parlay multipliers: your static group idea is exactly right

Replace the entire state bitmask SGP system (500+ lines, state_probabilities arrays, outcome_state_masks, compute_joint_probability_fp) with this:

```rust
enum GroupType { FTR=0, Goals=1, BTTS=2, AH=3, FirstGoal=4, CorrectScore=5, HTResult=6, PlayerProps=7 }

fn pairwise_discount(group_a: u8, group_b: u8, same_match: bool) -> u64 {
    match same_match {
        true if group_a == group_b => 7_000,   // 0.70x — heavily correlated or contradictory
        true                        => 9_200,   // 0.92x — cross-group same match
        false                       => 10_000,  // 1.00x — independent legs
    }
}
```

Total parlay discount = product of all pairwise discounts. Cross-match bonus = `(cross_match_legs - 1) × CROSS_MATCH_BONUS_BPS`, capped at `max_slip_bonus_bps`. Store `GroupType` as a `u8` field on Market (one byte, already room in the struct).

This replaces the entire SGP system, is understandable to any bettor, and takes about 30 lines of code. Within-group same-match parlays get heavily discounted because they're trivially correlated (betting Arsenal Win + Arsenal -1 Asian Handicap is nearly the same bet twice). Cross-group same-match is slightly discounted (Arsenal Win + Over 2.5 are correlated but not the same). Cross-match is full odds.

---

## What you discard vs keep

**Discard entirely:** `math/lmsr.rs`, `math/exp_ln.rs`, `math/fixed_point.rs`, `math/correlation.rs`, `q_values` on Market, the SGP state model, `compute_joint_probability_fp`, all LMSR buy/sell/price functions. About 600 lines of the most complex code in the repo.

**Keep unchanged:** All account structures and PDA seeds, epoch LP vault (all of it), settlement pipeline (propose_result, finalize_result), oracle signing, P2P order book (works exactly the same with fixed odds), emergency pause and claim_paused_bet, BetSlip multi-leg engine (just replace cost computation with direct odds multiplication).

**Add (net new):** `update_odds` instruction (~20 lines), `buy_at_odds` instruction (~40 lines replacing buy_shares), `GroupType` enum + pairwise discount function (~30 lines), volume_cap fields on Market (~10 lines of state), `max_exposure_multiplier` on epoch or GlobalConfig (~5 lines). Total new code: roughly 100-120 lines.

Net development effort: discard 600 lines of dense math, add 120 lines of straightforward logic. The contract gets significantly simpler. The account architecture, which is the hard part, stays intact.

---

## Timeline verdict

If you have three weeks or more: pivot to semi-static. The product is dramatically more intuitive for users, the LP pitch is cleaner, the code is simpler, and you're building something analogous to a decentralized Pinnacle rather than a novel AMM that nobody has used before.

If you need to ship in under two weeks: fix the six known bugs in the LMSR model and launch that. You can migrate the pricing engine post-launch when you have real user data. The account architecture supports both models — only the buy instruction and odds computation differ.

The two are not mutually exclusive either. You could launch with LMSR pricing and AI-seeded initial q_values (which you already support), then migrate to explicit AI-updated odds in V2 once you've validated the user flow and LP mechanics. The on-chain state transition would be: add `current_odds` field, add `update_odds` instruction, deprecate `buy_shares`, ship `buy_at_odds`. All backward compatible.
