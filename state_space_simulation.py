import math

# ---- 1. Build elementary state space: scorelines (home_goals, away_goals) ----
MAXG = 7  # 0..7 goals each side, 64 states, tail probability negligible after renorm
lam_home, lam_away = 1.55, 1.15  # typical home-advantage Poisson model

def poisson(k, lam):
    return math.exp(-lam) * lam**k / math.factorial(k)

states = [(h, a) for h in range(MAXG+1) for a in range(MAXG+1)]
raw_p = [poisson(h, lam_home) * poisson(a, lam_away) for (h, a) in states]
Z = sum(raw_p)
p0 = [x / Z for x in raw_p]  # renormalized initial probabilities per state

# ---- 2. LMSR over the state space ----
# liquidity depth b, worst-case LP loss bound = b * ln(num_states)
b = 5000.0
n = len(states)
print(f"states={n}, worst-case LP loss bound = b*ln(n) = {b*math.log(n):,.0f}")

q0 = [b * math.log(p) for p in p0]  # softmax(q/b) reproduces p0 exactly

def cost(q):
    m = max(q)
    return m + b * math.log(sum(math.exp((qi - m) / b) for qi in q))

def probs(q):
    m = max(q)
    ex = [math.exp((qi - m) / b) for qi in q]
    s = sum(ex)
    return [e / s for e in ex]

# ---- 3. Market masks (derived from state grid) ----
def mask_1x2(h, a):
    if h > a: return 'home'
    if h < a: return 'away'
    return 'draw'

def mask_ou25(h, a):
    return 'over' if (h + a) >= 3 else 'under'

def mask_gg(h, a):
    return 'gg' if (h >= 1 and a >= 1) else 'ng'

def market_odds(q):
    p = probs(q)
    out = {'home':0,'draw':0,'away':0,'over':0,'under':0,'gg':0,'ng':0}
    for (h,a), pi in zip(states, p):
        out[mask_1x2(h,a)] += pi
        out[mask_ou25(h,a)] += pi
        out[mask_gg(h,a)] += pi
    return out

before = market_odds(q0)
print("\n--- BEFORE any trade ---")
for k,v in before.items():
    print(f"  {k:6s}: {v*100:5.2f}%")

# ---- 4. Whale buys "Home Win" outcome (a bundle security: 1 in every home-win state) ----
home_states_idx = [i for i,(h,a) in enumerate(states) if h > a]

def buy_cost(q, idx_set, x):
    q2 = q[:]
    for i in idx_set:
        q2[i] += x
    return cost(q2) - cost(q)

# solve for x such that cost == target spend, via bisection
target_spend = 40000.0  # whale spends $40k
lo, hi = 0.0, 1_000_000.0
for _ in range(200):
    mid = (lo+hi)/2
    c = buy_cost(q0, home_states_idx, mid)
    if c < target_spend:
        lo = mid
    else:
        hi = mid
x_star = (lo+hi)/2
actual_spend = buy_cost(q0, home_states_idx, x_star)
print(f"\nWhale buys x={x_star:,.1f} 'home win' shares for ${actual_spend:,.0f}")

q1 = q0[:]
for i in home_states_idx:
    q1[i] += x_star

after = market_odds(q1)
print("\n--- AFTER whale buys Home Win ($40k) ---")
for k in before:
    d = (after[k]-before[k])*100
    print(f"  {k:6s}: {before[k]*100:5.2f}% -> {after[k]*100:5.2f}%   (Δ {d:+.2f} pts)")

print("\n\n=== Recalibrated: b sized to LP pool, graded trade sizes ===")
pool = 500_000.0
# choose b so worst-case loss bound is a sane % of pool, e.g. ~8%
b2 = (pool * 0.08) / math.log(n)
print(f"pool=${pool:,.0f}, chosen b={b2:,.0f} -> worst-case loss = ${b2*math.log(n):,.0f} ({b2*math.log(n)/pool*100:.1f}% of pool)")

def cost_b(q, bb):
    m = max(q)
    return m + bb * math.log(sum(math.exp((qi - m) / bb) for qi in q))

def probs_b(q, bb):
    m = max(q)
    ex = [math.exp((qi - m) / bb) for qi in q]
    s = sum(ex)
    return [e / s for e in ex]

q0b = [b2 * math.log(p) for p in p0]

def market_odds_b(q, bb):
    p = probs_b(q, bb)
    out = {'home':0,'draw':0,'away':0,'over':0,'under':0,'gg':0,'ng':0}
    for (h,a), pi in zip(states, p):
        out[mask_1x2(h,a)] += pi
        out[mask_ou25(h,a)] += pi
        out[mask_gg(h,a)] += pi
    return out

for spend in [500, 2000, 5000, 10000, 20000]:
    lo, hi = 0.0, 2_000_000.0
    for _ in range(200):
        mid = (lo+hi)/2
        q_try = q0b[:]
        for i in home_states_idx: q_try[i] += mid
        c = cost_b(q_try, b2) - cost_b(q0b, b2)
        if c < spend: lo = mid
        else: hi = mid
    x = (lo+hi)/2
    q1b = q0b[:]
    for i in home_states_idx: q1b[i] += x
    a = market_odds_b(q1b, b2)
    bef = market_odds_b(q0b, b2)
    print(f"\nspend=${spend:,}: home {bef['home']*100:.1f}->{a['home']*100:.1f}%  "
          f"away {bef['away']*100:.1f}->{a['away']*100:.1f}%  "
          f"draw {bef['draw']*100:.1f}->{a['draw']*100:.1f}%  "
          f"over2.5 {bef['over']*100:.1f}->{a['over']*100:.1f}%  "
          f"gg {bef['gg']*100:.1f}->{a['gg']*100:.1f}%")
