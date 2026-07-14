Uzochukwu, [11/07/2026 13:31]
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title StateSpaceLMSR9
/// @notice REFERENCE / RESEARCH IMPLEMENTATION — not audited, not gas-optimized.
///         Combinatorial LMSR over the MINIMAL SUFFICIENT state space for
///         exactly 3 correlated markets: 1x2, Over/Under 2.5, GG/NG.
///
///         Instead of modeling every scoreline (25-64+ states, most of it
///         resolution nobody trades on), this models only the composite
///         (1x2 x O/U x GG/NG) buckets. Of the 12 theoretical combinations,
///         9 are feasible; 3 are mathematically impossible by construction
///         (e.g. Home-win + Under2.5 + GG requires h>a, h+a<3, h>=1, a>=1 —
///         no integer scoreline satisfies all four constraints at once).
///         This is not an approximation or a lossy simplification: it is the
///         exact sufficient statistic for pricing these 3 markets. No
///         correlation information relevant to the product is lost, while
///         per-trade on-chain work drops ~3-7x vs a full scoreline grid.
///
///         Mirrors the architecture intended for the Solana/Anchor
///         quadratic_market program's group-level pricing. Exists to
///         validate the math/mechanism in an EVM sandbox before porting to
///         Rust/Anchor.
///
/// @dev Buying an outcome (e.g. Home Win) adds shares to every one of the 9
///      composite states consistent with that outcome — a combinatorial
///      Arrow-Debreu bundle per Hanson (2003) market scoring rules. Every
///      market's odds are a different partition over the same 9-state
///      distribution, which keeps 1x2 / O-U / GG-NG mutually consistent
///      (arbitrage-free) under a single trade.
contract StateSpaceLMSR9 {
    // ---- Fixed point: WAD = 1e18 ----
    int256 internal constant WAD = 1e18;
    uint8 internal constant N = 9;

    int256 public immutable b; // WAD-scaled liquidity depth

    // The 9 feasible composite states, indexed 0..8:
    // 0: home,over,gg   1: home,under,ng  2: home,over,ng
    // 3: away,over,gg   4: away,under,ng  5: away,over,ng
    // 6: draw,under,gg  7: draw,under,ng  8: draw,over,gg
    //
    // (home,under,gg) / (away,under,gg) / (draw,over,ng) are structurally
    // infeasible and correctly excluded — not merely low-probability.
    uint8 internal constant M1X2_HOME = 0;
    uint8 internal constant M1X2_AWAY = 1;
    uint8 internal constant M1X2_DRAW = 2;
    uint8 internal constant MOU_OVER = 0;
    uint8 internal constant MOU_UNDER = 1;
    uint8 internal constant MGG_GG = 0;
    uint8 internal constant MGG_NG = 1;

    uint8[9] internal STATE_1X2 = [
        M1X2_HOME, M1X2_HOME, M1X2_HOME,
        M1X2_AWAY, M1X2_AWAY, M1X2_AWAY,
        M1X2_DRAW, M1X2_DRAW, M1X2_DRAW
    ];
    uint8[9] internal STATE_OU = [
        MOU_OVER, MOU_UNDER, MOU_OVER,
        MOU_OVER, MOU_UNDER, MOU_OVER,
        MOU_UNDER, MOU_UNDER, MOU_OVER
    ];
    uint8[9] internal STATE_GG = [
        MGG_GG, MGG_NG, MGG_NG,
        MGG_GG, MGG_NG, MGG_NG,
        MGG_GG, MGG_NG, MGG_GG
    ];

    // q[s] = WAD-scaled cumulative share quantity held against state s
    int256[9] public q;

    address public admin;
    bool public tradingOpen = true;

    enum MarketId { ONE_X_TWO, OVER_UNDER_25, GG_NG }
    enum Outcome { HOME, AWAY, DRAW, OVER, UNDER, GG, NG }

    event Traded(address indexed trader, Outcome outcome, int256 shares, uint256 costWad);
    event OddsSnapshot(uint256 home, uint256 away, uint256 draw, uint256 over, uint256 under, uint256 gg, uint256 ng);

    modifier onlyAdmin() {
        require(msg.sender == admin, "not admin");
        _;
    }

    /// @param _bWad liquidity depth b, WAD-scaled. Size so worst-case LMSR
    ///        loss (b * ln(9)) is a sane fraction of the LP pool backing

Uzochukwu, [11/07/2026 13:31]
///        this group — see off-chain calibration before deploying.
    /// @param initialStateProbsWad WAD-scaled probabilities for the 9 states
    ///        in the fixed order above, must sum to ~1e18. Computed
    ///        off-chain (Poisson home/away goal model aggregated into these
    ///        buckets) since it only needs to happen once, at group creation.
    constructor(int256 _bWad, int256[9] memory initialStateProbsWad) {
        require(_bWad > 0, "b must be positive");
        b = _bWad;
        admin = msg.sender;
        for (uint8 s = 0; s < N; s++) {
            require(initialStateProbsWad[s] > 0, "zero-prob state unsupported");
            q[s] = wmul(_bWad, ln(initialStateProbsWad[s]));
        }
    }

    // ───────────────────────── Market mask logic ─────────────────────────

    function _matchesOutcome(uint8 s, Outcome o) internal view returns (bool) {
        if (o == Outcome.HOME) return STATE_1X2[s] == M1X2_HOME;
        if (o == Outcome.AWAY) return STATE_1X2[s] == M1X2_AWAY;
        if (o == Outcome.DRAW) return STATE_1X2[s] == M1X2_DRAW;
        if (o == Outcome.OVER) return STATE_OU[s] == MOU_OVER;
        if (o == Outcome.UNDER) return STATE_OU[s] == MOU_UNDER;
        if (o == Outcome.GG) return STATE_GG[s] == MGG_GG;
        if (o == Outcome.NG) return STATE_GG[s] == MGG_NG;
        revert("bad outcome");
    }

    // ───────────────────────── Core LMSR cost function ─────────────────────────

    function _cost() internal view returns (int256) {
        int256 m = _maxQ();
        int256 sumExp = 0;
        for (uint8 s = 0; s < N; s++) {
            sumExp += exp(wdiv(q[s] - m, b));
        }
        return m + wmul(b, ln(sumExp));
    }

    function _maxQ() internal view returns (int256 m) {
        m = q[0];
        for (uint8 s = 1; s < N; s++) {
            if (q[s] > m) m = q[s];
        }
    }

    /// @notice Cost (WAD) to buy sharesWad of outcome. Positive = trader pays in.
    function quoteBuy(Outcome outcome, int256 sharesWad) public view returns (int256 costWad) {
        require(sharesWad > 0, "shares must be positive");
        int256 before = _cost();

        int256 m = type(int256).min;
        for (uint8 s = 0; s < N; s++) {
            int256 qs = q[s];
            if (_matchesOutcome(s, outcome)) qs += sharesWad;
            if (qs > m) m = qs;
        }
        int256 sumExp = 0;
        for (uint8 s = 0; s < N; s++) {
            int256 qs = q[s];
            if (_matchesOutcome(s, outcome)) qs += sharesWad;
            sumExp += exp(wdiv(qs - m, b));
        }
        int256 after_ = m + wmul(b, ln(sumExp));
        costWad = after_ - before;
    }

    /// @notice Execute a buy. Payment/custody intentionally omitted — this
    ///         contract isolates the pricing mechanism only.
    function buy(Outcome outcome, int256 sharesWad) external returns (int256 costWad) {
        require(tradingOpen, "trading closed");
        costWad = quoteBuy(outcome, sharesWad);
        for (uint8 s = 0; s < N; s++) {
            if (_matchesOutcome(s, outcome)) q[s] += sharesWad;
        }
        emit Traded(msg.sender, outcome, sharesWad, uint256(costWad));
        return costWad;
    }

    // ───────────────────────── Read-only odds views ─────────────────────────

    function odds(Outcome outcome) public view returns (int256) {
        int256 m = _maxQ();
        int256 sumExp = 0;
        int256 matchExp = 0;
        for (uint8 s = 0; s < N; s++) {
            int256 e = exp(wdiv(q[s] - m, b));
            sumExp += e;
            if (_matchesOutcome(s, outcome)) matchExp += e;
        }
        return wdiv(matchExp, sumExp);
    }

    function snapshotOdds() external returns (
        uint256 home, uint256 away, uint256 draw,
        uint256 over, uint256 under, uint256 gg, uint256 ng

Uzochukwu, [11/07/2026 13:31]
) {
        home  = uint256(odds(Outcome.HOME));
        away  = uint256(odds(Outcome.AWAY));
        draw  = uint256(odds(Outcome.DRAW));
        over  = uint256(odds(Outcome.OVER));
        under = uint256(odds(Outcome.UNDER));
        gg    = uint256(odds(Outcome.GG));
        ng    = uint256(odds(Outcome.NG));
        emit OddsSnapshot(home, away, draw, over, under, gg, ng);
    }

    /// @notice Worst-case LP loss bound for this book: b * ln(9).
    function worstCaseLossBound() external view returns (int256) {
        return wmul(b, ln(int256(uint256(N)) * WAD));
    }

    function closeTrading() external onlyAdmin {
        tradingOpen = false;
    }

    // ───────────────────────── Fixed-point math (WAD, 1e18) ─────────────────────────
    // Demo-grade exp/ln. Swap for a vetted library before any real deployment.

    int256 internal constant LN2_WAD = 693147180559945309;

    function wmul(int256 x, int256 y) internal pure returns (int256) {
        return (x * y) / WAD;
    }

    function wdiv(int256 x, int256 y) internal pure returns (int256) {
        return (x * WAD) / y;
    }

    function exp(int256 x) internal pure returns (int256) {
        if (x == 0) return WAD;
        bool neg = x < 0;
        if (neg) x = -x;
        int256 k = x / LN2_WAD;
        int256 r = x - k * LN2_WAD;
        int256 term = WAD;
        int256 sum = WAD;
        for (uint256 i = 1; i <= 12; i++) {
            term = wmul(term, r) / int256(i);
            sum += term;
        }
        int256 result = sum;
        if (k > 0) {
            require(k < 64, "exp overflow");
            result = result << uint256(k);
        }
        return neg ? wdiv(WAD, result) : result;
    }

    function ln(int256 x) internal pure returns (int256) {
        require(x > 0, "ln domain");
        int256 k = 0;
        while (x >= 2 * WAD) { x = x / 2; k++; }
        while (x < WAD) { x = x * 2; k--; }
        int256 z = wdiv(x - WAD, x + WAD);
        int256 z2 = wmul(z, z);
        int256 term = z;
        int256 sum = z;
        for (uint256 i = 1; i <= 8; i++) {
            term = wmul(term, z2);
            sum += term / int256(2 * i + 1);
        }
        return k * LN2_WAD + 2 * sum;
    }
}
