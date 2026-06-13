cat << 'EOF' > /tmp/verdict.py
print("""
THE HONEST CASE FOR SEMI-STATIC OVER LMSR
==========================================

WHY LMSR MADE SENSE AS A STARTING POINT
─────────────────────────────────────────
LMSR was the right engineering choice for a prediction market protocol
where you have no prior information about probabilities. Polymarket uses
it because they literally don't know what the probability of a political
event is — neither does anyone else — so you let the crowd discover it.

Sports is fundamentally different.

Arsenal vs Man City on Saturday has a known probability distribution
BEFORE a single bet is placed. Pinnacle, Betfair, Sportradar — 
they've already priced it with millions of data points and decades
of calibration. The probability is not unknown. It's just not yet 
on your platform.

LMSR starts at 50/50 on a 2-outcome market and drifts from there.
Your first bettors are subsidizing price discovery that Pinnacle 
already did for free. That's inefficient and punishes early users.

initial_q_values was your workaround. You seed from AI/Odds API 
to get correct starting prices. But once you're doing that, you've 
already accepted that the right prices come from an external model,
not from flow. You're halfway to semi-static already.

WHY SEMI-STATIC IS THE RIGHT ARCHITECTURE FOR SPORTS
──────────────────────────────────────────────────────
Sports betting has 100 years of solved infrastructure.
The pricing problem is solved. The settlement problem is solved.
The risk management problem is solved. What isn't solved is:

  Who captures the house edge? → Decentralize it to LPs.
  Who controls custody? → Nobody. Smart contract.
  Who can verify fairness? → Anyone. On-chain.

That's your actual value proposition. Not a novel AMM.
A decentralized Pinnacle. That's a much cleaner pitch.

THE THREE THINGS LMSR DOES THAT YOU DON'T NEED
────────────────────────────────────────────────
1. Price discovery — You don't need it. Sports prices are known.
2. Self-regulation via price pressure — You replace this with AI 
   monitoring flow and updating odds. Same outcome, cleaner UX.
3. Mathematical guarantees on LP loss — You replace this with 
   explicit volume caps. More understandable, same protection.

THE ONE THING SEMI-STATIC NEEDS THAT LMSR GIVES FOR FREE
──────────────────────────────────────────────────────────
Trustless pricing. LMSR needs no oracle for odds. Anyone can verify 
the price from q_values. Semi-static needs you to run an honest AI.

This is the real tradeoff. It's not a technical tradeoff.
It's a trust tradeoff. You're asking LPs and bettors to trust 
that your AI isn't systematically shading lines.

The mitigation is real: commit odds_anchor on-chain, enforce 
max_deviation_bps, publish your source (The Odds API / Pinnacle).
Anyone can verify at bet time that your odds are within tolerance.
That's a credible commitment mechanism.

But you should be clear-eyed: you're trading trustlessness for UX.
That's a valid trade. Just make it deliberately.

WHERE I'D PUSH BACK ON YOUR INSTINCTS
───────────────────────────────────────
1. "AI keeps analysing match and user behaviour to change odds"
   
   CAREFUL: Changing odds based on user betting behaviour alone 
   is gameable (Scenario 2 from earlier). The AI must primarily 
   anchor to EXTERNAL market consensus, not internal flow.
   Internal flow is a SECONDARY signal with a hard cap on influence.
   
   If you let AI move odds purely based on your users betting,
   sophisticated bettors will game it within a week.

2. "LP will have risk of the odds amount"
   
   You need to be more specific than this for LP onboarding.
   "High risk high reward" is not a risk disclosure. You need:
   - max_exposure_multiplier: 1.5x (LP can lose max 50% of deposit)
   - expected_yield_bps: target 1500 bps above market rate
   - epoch_drawdown_history: show backtested P&L across past seasons
   
   LPs will demand numbers. "Some epochs will generate high PnL 
   and some might loss" is true of every investment ever made.
   Give them the distribution, not just the possibility.

3. "Tell bettors odds are subject to change"
   
   This is fine. Every sportsbook does this. But you need:
   - min_odds parameter on buy_at_odds (user sets their floor)
   - Odds lock window: once user initiates bet, odds locked for 
     30 seconds to allow tx confirmation (standard practice)
   - Clear UI: "Odds as of 14:23:07. Valid for 30 seconds."
   
   Without this, front-running becomes possible. Someone sees
   you're about to submit a bet at 2.80, submits update_odds 
   to 2.60 first, your tx lands at worse odds than you saw.
   min_odds protects against this.

THE ARCHITECTURE DECISION MATRIX
──────────────────────────────────
                    LMSR          SEMI-STATIC
Code complexity:    HIGH          LOW
User UX:            POOR          EXCELLENT  
LP pitch clarity:   MEDIUM        HIGH
Trust model:        TRUSTLESS     TRUSTED AI
Time to ship:       3 days        1 week
Regulatory clarity: AMBIGUOUS     CLEAR (fixed odds)
Competitive moat:   NOVEL MATH    DECENTRALIZED INFRA
Scalability:        BOUNDED BY B  BOUNDED BY LP DEPOSIT
Sports suitability: POOR          EXCELLENT

I'd support the pivot. The code you throw away is math complexity
that was solving a problem you don't actually have.
The code you keep is the infrastructure that matters.
The code you add is straightforward.

WHAT I'D DO IN YOUR POSITION
──────────────────────────────
Week 1: Rewrite core betting instruction (buy_at_odds, update_odds)
        Replace q_values with current_odds on Market struct
        Add volume_cap per outcome
        Delete math/lmsr.rs, math/correlation.rs SGP system
        Add GroupType enum + pairwise discount (30 lines)
        
Week 2: Wire AI bot to The Odds API
        Bot computes initial odds at market creation
        Bot monitors and submits update_odds when deviation > threshold
        Add max_deviation_bps enforcement on-chain
        Fix the 6 known bugs (C-01 through C-06)
        
Week 3: Test end-to-end on devnet with 3 real EPL matches
        LP deposits, bets placed, settlement, withdrawal
        Validate P&L accounting is correct under all scenarios
        
Week 4: Mainnet alpha. 2-3 Premier League markets.
        Invite 20 alpha users. Learn.

That's a real launch in 4 weeks. LMSR was also 4 weeks away
but with less confidence in the user experience.
""")
EOF
python3 /tmp/verdict.py
Output


THE HONEST CASE FOR SEMI-STATIC OVER LMSR
==========================================

WHY LMSR MADE SENSE AS A STARTING POINT
─────────────────────────────────────────
LMSR was the right engineering choice for a prediction market protocol
where you have no prior information about probabilities. Polymarket uses
it because they literally don't know what the probability of a political
event is — neither does anyone else — so you let the crowd discover it.

Sports is fundamentally different.

Arsenal vs Man City on Saturday has a known probability distribution
BEFORE a single bet is placed. Pinnacle, Betfair, Sportradar — 
they've already priced it with millions of data points and decades
of calibration. The probability is not unknown. It's just not yet 
on your platform.

LMSR starts at 50/50 on a 2-outcome market and drifts from there.
Your first bettors are subsidizing price discovery that Pinnacle 
already did for free. That's inefficient and punishes early users.

initial_q_values was your workaround. You seed from AI/Odds API 
to get correct starting prices. But once you're doing that, you've 
already accepted that the right prices come from an external model,
not from flow. You're halfway to semi-static already.

WHY SEMI-STATIC IS THE RIGHT ARCHITECTURE FOR SPORTS
──────────────────────────────────────────────────────
Sports betting has 100 years of solved infrastructure.
The pricing problem is solved. The settlement problem is solved.
The risk management problem is solved. What isn't solved is:

  Who captures the house edge? → Decentralize it to LPs.
  Who controls custody? → Nobody. Smart contract.
  Who can verify fairness? → Anyone. On-chain.

That's your actual value proposition. Not a novel AMM.
A decentralized Pinnacle. That's a much cleaner pitch.

THE THREE THINGS LMSR DOES THAT YOU DON'T NEED
────────────────────────────────────────────────
1. Price discovery — You don't need it. Sports prices are known.
2. Self-regulation via price pressure — You replace this with AI 
   monitoring flow and updating odds. Same outcome, cleaner UX.
3. Mathematical guarantees on LP loss — You replace this with 
   explicit volume caps. More understandable, same protection.

THE ONE THING SEMI-STATIC NEEDS THAT LMSR GIVES FOR FREE
──────────────────────────────────────────────────────────
Trustless pricing. LMSR needs no oracle for odds. Anyone can verify 
the price from q_values. Semi-static needs you to run an honest AI.

This is the real tradeoff. It's not a technical tradeoff.
It's a trust tradeoff. You're asking LPs and bettors to trust 
that your AI isn't systematically shading lines.

The mitigation is real: commit odds_anchor on-chain, enforce 
max_deviation_bps, publish your source (The Odds API / Pinnacle).
Anyone can verify at bet time that your odds are within tolerance.
That's a credible commitment mechanism.

But you should be clear-eyed: you're trading trustlessness for UX.
That's a valid trade. Just make it deliberately.

WHERE I'D PUSH BACK ON YOUR INSTINCTS
───────────────────────────────────────
1. "AI keeps analysing match and user behaviour to change odds"
   
   CAREFUL: Changing odds based on user betting behaviour alone 
   is gameable (Scenario 2 from earlier). The AI must primarily 
   anchor to EXTERNAL market consensus, not internal flow.
   Internal flow is a SECONDARY signal with a hard cap on influence.
   
   If you let AI move odds purely based on your users betting,
   sophisticated bettors will game it within a week.

2. "LP will have risk of the odds amount"
   
   You need to be more specific than this for LP onboarding.
   "High risk high reward" is not a risk disclosure. You need:
   - max_exposure_multiplier: 1.5x (LP can lose max 50% of deposit)
   - expected_yield_bps: target 1500 bps above market rate
   - epoch_drawdown_history: show backtested P&L across past seasons
   
   LPs will demand numbers. "Some epochs will generate high PnL 
   and some might loss" is true of every investment ever made.
   Give them the distribution, not just the possibility.

3. "Tell bettors odds are subject to change"
   
   This is fine. Every sportsbook does this. But you need:
   - min_odds parameter on buy_at_odds (user sets their floor)
   - Odds lock window: once user initiates bet, odds locked for 
     30 seconds to allow tx confirmation (standard practice)
   - Clear UI: "Odds as of 14:23:07. Valid for 30 seconds."
   
   Without this, front-running becomes possible. Someone sees
   you're about to submit a bet at 2.80, submits update_odds 
   to 2.60 first, your tx lands at worse odds than you saw.
   min_odds protects against this.

THE ARCHITECTURE DECISION MATRIX
──────────────────────────────────
                    LMSR          SEMI-STATIC
Code complexity:    HIGH          LOW
User UX:            POOR          EXCELLENT  
LP pitch clarity:   MEDIUM        HIGH
Trust model:        TRUSTLESS     TRUSTED AI
Time to ship:       3 days        1 week
Regulatory clarity: AMBIGUOUS     CLEAR (fixed odds)
Competitive moat:   NOVEL MATH    DECENTRALIZED INFRA
Scalability:        BOUNDED BY B  BOUNDED BY LP DEPOSIT
Sports suitability: POOR          EXCELLENT

I'd support the pivot. The code you throw away is math complexity
that was solving a problem you don't actually have.
The code you keep is the infrastructure that matters.
The code you add is straightforward.

WHAT I'D DO IN YOUR POSITION
──────────────────────────────
Week 1: Rewrite core betting instruction (buy_at_odds, update_odds)
        Replace q_values with current_odds on Market struct
        Add volume_cap per outcome
        Delete math/lmsr.rs, math/correlation.rs SGP system
        Add GroupType enum + pairwise discount (30 lines)
        
Week 2: Wire AI bot to The Odds API
        Bot computes initial odds at market creation
        Bot monitors and submits update_odds when deviation > threshold
        Add max_deviation_bps enforcement on-chain
        Fix the 6 known bugs (C-01 through C-06)
        
Week 3: Test end-to-end on devnet with 3 real EPL matches
        LP deposits, bets placed, settlement, withdrawal
        Validate P&L accounting is correct under all scenarios
        
Week 4: Mainnet alpha. 2-3 Premier League markets.
        Invite 20 alpha users. Learn.

That's a real launch in 4 weeks. LMSR was also 4 weeks away
but with less confidence in the user experience.

Done

You are out of free messages until 4:30 AM
