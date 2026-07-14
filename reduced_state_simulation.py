import math

lam_home, lam_away = 1.55, 1.15
MAXG = 12  # wide enough that tail is negligible

def poisson(k, lam):
    return math.exp(-lam) * lam**k / math.factorial(k)

def bucket(h, a):
    # 1x2
    if h > a: onextwo = 'home'
    elif h < a: onextwo = 'away'
    else: onextwo = 'draw'
    ou = 'over' if (h+a) >= 3 else 'under'
    gg = 'gg' if (h>=1 and a>=1) else 'ng'
    return (onextwo, ou, gg)

# Aggregate every scoreline into its composite bucket
buckets = {}
for h in range(MAXG+1):
    for a in range(MAXG+1):
        p = poisson(h, lam_home) * poisson(a, lam_away)
        k = bucket(h, a)
        buckets[k] = buckets.get(k, 0.0) + p

Z = sum(buckets.values())
buckets = {k: v/Z for k, v in buckets.items()}

print(f"Feasible composite states: {len(buckets)} (out of 12 theoretical combos)\n")
for k, v in sorted(buckets.items(), key=lambda x: -x[1]):
    print(f"  {k}: {v*100:.3f}%")

infeasible = set([('home','under','gg'), ('away','under','gg'), ('draw','over','ng')])
print(f"\nConfirmed infeasible (structurally impossible): {infeasible}")
print("Present in buckets?", [k for k in infeasible if k in buckets])

print("\n\n=== LMSR on the 9-state reduced space ===")
states = list(buckets.keys())
p0 = [buckets[s] for s in states]
n = len(states)

pool = 500_000.0
b = (pool * 0.08) / math.log(n)
print(f"n={n} states, b={b:,.0f}, worst-case loss=${b*math.log(n):,.0f}")

q0 = [b * math.log(p) for p in p0]

def cost(q, bb):
    m = max(q)
    return m + bb*math.log(sum(math.exp((qi-m)/bb) for qi in q))

def probs(q, bb):
    m = max(q)
    ex = [math.exp((qi-m)/bb) for qi in q]
    s = sum(ex)
    return [e/s for e in ex]

def market_odds(q, bb):
    p = probs(q, bb)
    out = {'home':0,'draw':0,'away':0,'over':0,'under':0,'gg':0,'ng':0}
    for s, pi in zip(states, p):
        out[s[0]] += pi
        out[s[1]] += pi
        out[s[2]] += pi
    return out

home_idx = [i for i,s in enumerate(states) if s[0]=='home']

for spend in [500, 2000, 5000, 10000]:
    lo, hi = 0.0, 2_000_000.0
    for _ in range(200):
        mid=(lo+hi)/2
        qtry = q0[:]
        for i in home_idx: qtry[i]+=mid
        c = cost(qtry,b)-cost(q0,b)
        if c<spend: lo=mid
        else: hi=mid
    x=(lo+hi)/2
    q1=q0[:]
    for i in home_idx: q1[i]+=x
    bef=market_odds(q0,b); aft=market_odds(q1,b)
    print(f"\nspend=${spend:,}: home {bef['home']*100:.1f}->{aft['home']*100:.1f}%  "
          f"away {bef['away']*100:.1f}->{aft['away']*100:.1f}%  draw {bef['draw']*100:.1f}->{aft['draw']*100:.1f}%  "
          f"over2.5 {bef['over']*100:.1f}->{aft['over']*100:.1f}%  gg {bef['gg']*100:.1f}->{aft['gg']*100:.1f}%")
