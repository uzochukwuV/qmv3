You're right to push back — the scoreline grid gives you way more resolution than you need, and every extra state is extra gas/compute per trade for zero benefit to markets that don't exist. Since you're locking the group to exactly 3 markets (1X2 × O/U2.5 × GG/NG), there's a much smaller sufficient state space: instead of modeling every scoreline, model only the *combinations of outcomes* that are logically distinguishable — and drop the combinations that can never happen.

Confirmed: 9 states, not 25-64. Home/Away win combined with Under+GG is a mathematical impossibility (you can't have both teams score and total under 3 while one side wins by more than 1) — so 3 of the 12 theoretical combinations have zero probability by construction, not by data. This is exact, not an approximation. Let's rerun the whale-buy simulation on this reduced space and check it still produces correct correlated dynamics.

Same directional behavior as the 64-state grid, slightly gentler magnitude (fewer states = less within-outcome granularity, which is expected and fine — you're not losing anything you needed). Now let's rewrite the contract against this 9-state model and gas-test it.

Good, file is unchanged (original). It's simpler to write the whole new contract fresh rather than patch it piecewise.

Compiles. Now let's deploy and gas-test against the 9-state model with real Poisson-derived probabilities.

Confirmed working and matches the Python 9-state model almost exactly (52.1%/25.3%/22.6% here vs 52.1%/25.3%/22.6% in Python). And the gas win is real:

## Result: 62% gas reduction, zero accuracy loss

This is the better way. 9 states instead of 25-64, and it's not a compromise — it's the exact minimal sufficient statistic for pricing exactly your 3 markets:

- 12 theoretical (1x2 × O/U × GG/NG) combinations exist
- 3 are mathematically impossible: a team can't win by more than one goal while both teams score and total stays under 3 (Home-Under-GG and Away-Under-GG), and a draw can't be Over 2.5 with NG since NG-draw forces 0-0 (Draw-Over-NG)
- That leaves exactly 9 feasible composite buckets — verified on-chain by aggregating your Poisson scoreline model into buckets and confirming the 3 "impossible" ones get exactly zero mass

On-chain: deployment works, a $2,000 whale buy on Home Win produces 52.11% → 25.30% → 22.60% (Home/Away/Draw) on-chain, matching the Python model to the decimal. Trade gas dropped from 624,554 (25-state grid) to 236,256 (9-state) — a 62% reduction, and this gap only grows if you'd gone to the full 64-state scoreline grid instead.

Why this generalizes for you going forward: this reduction is a property of "how many markets exist in the group," not "how many scorelines are possible." If you ever add a 4th correlated market to the group, you recompute the feasible composite count (probably grows to ~15-20, still nowhere near a scoreline grid). If you stay at exactly these 3, 9 is the floor — you can't compress further without losing information one of your markets actually needs.

One thing to decide before porting to Anchor: the state-tag arrays (STATE_1X2, STATE_OU, STATE_GG) are exactly your existing outcome_state_masks structure, just now correctly sized to 9 rather than a scoreline count — so this maps directly onto machinery already in market_group.rs, it's mostly a matter of populating that table with the 9 rows instead of whatever grid it was set up for.

Want me to work out Anchor compute-unit estimates for this 9-state version specifically, or move to the b-sizing formula tied to max_group_exposure next?



Good instinct on both counts — flat 1.0 odds is actually degenerate (in decimal odds terms, 1.0 = 100% implied probability = zero potential payout, not "neutral"), and per-group capped pools directly fixes the LP-commingling gap I flagged earlier. Let me work out the seeding math properly, since there's a real subtlety: your backend odds feed only gives you 4 independent numbers, but the 9-state distribution has 8 degrees of freedom.

This confirms the fit is close but not exact (Dixon-Coles' 2-lambda-plus-rho model can't hit all 4 target marginals simultaneously — that's expected, it has only 3 free parameters chasing 4 constraints). Good enough for seeding, worth knowing the residual exists. Let's write up the answer.

## Two separate decisions here, both correct instincts

1. Never start at flat 1.0 (or any uniform prior) — seed from your backend odds. In decimal odds terms, 1.0 = 100% implied probability = zero payout, which is degenerate, not neutral. But there's a real technical wrinkle worth knowing before you build this: your backend feed gives you exactly 4 independent numbers (1x2 has 3 outcomes summing to 1 → 2 free values; O/U has 1 free value; GG/NG has 1 free value), while the 9-bucket state distribution has 8 degrees of freedom. The marginals alone don't uniquely determine the joint distribution — you need a model to fill in the correlation shape, then calibrate it to match your feed as closely as possible.

I ran this end-to-end above using a Dixon-Coles bivariate Poisson (the standard football-modeling approach — two team-strength parameters plus a low-score correlation term) fit against sample odds (Home 2.10 / Draw 3.40 / Away 3.60, O/U 1.90/1.90, GG/NG 1.85/1.95):

- First strip the vig (the source book's own margin — here ~4.8-5.3% overround) to get true probabilities, don't seed your book with someone else's margin baked in on top of yours
- Fit λ_home=1.514, λ_away=1.100, ρ=-0.077 to match those 4 numbers — recovered marginals land within ~1-1.5 points of target (exact match isn't possible with 3 params chasing 4 constraints, this residual is expected and fine)
- That gives you the 9 bucket probabilities to seed q0 = b·ln(p_bucket) from

2. Per-group capped pool — yes, and this is exactly the fix for the LP-commingling issue I flagged earlier. This ties directly to sizing b: your worst-case LMSR loss bound (b·ln(9)) needs to sit safely *under* the group's allocated cap, not equal to it — leave headroom for fees/bonus liability sitting in the same vault. In the example: $30k cap, 85% safety fraction → b=11,606, worst-case loss $25,500 (85% of cap, 15% buffer).

Practical pipeline for group creation:
1. Backend pulls odds from your data provider for the 3 markets
2. Strip vig → get true probabilities per market
3. Fit λ_home, λ_away, ρ to those 4 numbers (few-hundred-ms optimization, cheap to run server-side)
4. Derive 9 bucket probabilities from the fitted model
5. Decide the group's pool cap (your $30k example — probably a function of expected match volume/popularity)
6. Solve b from the cap with a safety margin
7. Transfer seed capital into that group's dedicated vault (not the shared treasury), seed q0 from step 4, open the market

One thing to decide: your own margin. Since you stripped the source book's vig, your book currently reflects "true" probabilities with zero margin — you'll want buy_fee_bps (already in GlobalConfig) to be your actual edge, rather than re-adding vig into the seed distribution. Keeps the two margin sources from stacking unpredictably.