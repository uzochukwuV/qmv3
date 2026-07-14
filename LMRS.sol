// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title StateSpaceLMSR
/// @notice REFERENCE / RESEARCH IMPLEMENTATION — not audited, not gas-optimized.
///         Demonstrates a combinatorial LMSR over a small elementary state space
///         (football scorelines), from which multiple correlated markets
///         (1x2, Over/Under 2.5, GG/NG) derive consistent odds automatically.
///
///         This mirrors the architecture intended for the Solana/Anchor
///         `quadratic_market` program's group-level pricing. It exists purely
///         to validate the math and mechanism in an EVM sandbox (Hardhat/Foundry)
///         before porting the logic to Rust/Anchor.
///
/// @dev State space: scorelines (home_goals, away_goals) for home in [0,MAXG],
///      away in [0,MAXG], flattened to a single index. Buying an "outcome"
///      (e.g. Home Win) adds shares to every elementary state consistent with
///      that outcome — a combinatorial Arrow-Debreu bundle, per Hanson (2003)
///      market scoring rules. Every market's odds are just a different
///      partition (mask) over the same state distribution, which is what
///      keeps 1x2 / O-U / GG-NG mutually consistent under a single trade.
contract StateSpaceLMSR {
    // ---- Fixed point: WAD = 1e18 ----
    int256 internal constant WAD = 1e18;

    uint8 public immutable maxGoals;   // grid is (maxGoals+1) x (maxGoals+1)
    uint16 public immutable numStates; // (maxGoals+1)^2
    int256 public immutable b;         // WAD-scaled liquidity depth

    // q[s] = WAD-scaled cumulative share quantity held against state s
    mapping(uint16 => int256) public q;

    address public admin;
    bool public tradingOpen = true;

    enum MarketId { ONE_X_TWO, OVER_UNDER_25, GG_NG }
    enum Outcome { HOME, DRAW, AWAY, OVER, UNDER, GG, NG }

    event Traded(address indexed trader, Outcome outcome, int256 shares, uint256 costWad);
    event OddsSnapshot(uint256 home, uint256 draw, uint256 away, uint256 over, uint256 under, uint256 gg, uint256 ng);

    modifier onlyAdmin() {
        require(msg.sender == admin, "not admin");
        _;
    }

    /// @param _maxGoals grid bound per side (e.g. 7 => 64 states)
    /// @param _bWad liquidity depth b, WAD-scaled. MUST be sized so that
    ///        worst-case LMSR loss (b * ln(numStates)) is a sane fraction
    ///        of the LP pool backing this group — see off-chain calibration.
    /// @param initialStateProbsWad WAD-scaled probabilities per state,
    ///        length must equal (maxGoals+1)^2, must sum to ~1e18.
    ///        Computed off-chain (e.g. Poisson home/away goal model) since
    ///        ln() over an arbitrary prior is cheaper to do once off-chain
    ///        than iteratively on-chain at deploy time.
    constructor(uint8 _maxGoals, int256 _bWad, int256[] memory initialStateProbsWad) {
        require(_bWad > 0, "b must be positive");
        maxGoals = _maxGoals;
        uint16 n = uint16(uint256(_maxGoals) + 1) * uint16(uint256(_maxGoals) + 1);
        numStates = n;
        require(initialStateProbsWad.length == n, "bad prior length");
        b = _bWad;
        admin = msg.sender;

        for (uint16 s = 0; s < n; s++) {
            require(initialStateProbsWad[s] > 0, "zero-prob state unsupported");
            // q_s = b * ln(p_s)  =>  softmax(q/b) reproduces the prior exactly
            q[s] = wmul(_bWad, ln(initialStateProbsWad[s]));
        }
    }

    // ───────────────────────── Market mask logic ─────────────────────────

    function _scoreOf(uint16 s) internal view returns (uint8 h, uint8 a) {
        uint16 side = uint16(maxGoals) + 1;
        h = uint8(s / side);
        a = uint8(s % side);
    }

    function _matchesOutcome(uint16 s, Outcome o) internal view returns (bool) {
        (uint8 h, uint8 a) = _scoreOf(s);
        if (o == Outcome.HOME) return h > a;
        if (o == Outcome.DRAW) return h == a;
        if (o == Outcome.AWAY) return h < a;
        if (o == Outcome.OVER) return (uint16(h) + uint16(a)) >= 3;
        if (o == Outcome.UNDER) return (uint16(h) + uint16(a)) < 3;
        if (o == Outcome.GG) return h >= 1 && a >= 1;
        if (o == Outcome.NG) return !(h >= 1 && a >= 1);
        revert("bad outcome");
    }

    // ───────────────────────── Core LMSR cost function ─────────────────────────

    /// @dev C(q) = b * ln( sum_s exp(q_s / b) ), computed with a max-shift
    ///      for numerical stability (standard log-sum-exp trick).
    function _cost() internal view returns (int256) {
        int256 m = _maxQ();
        int256 sumExp = 0;
        for (uint16 s = 0; s < numStates; s++) {
            sumExp += exp(wdiv(q[s] - m, b));
        }
        return m + wmul(b, ln(sumExp));
    }

    function _maxQ() internal view returns (int256 m) {
        m = type(int256).min;
        for (uint16 s = 0; s < numStates; s++) {
            if (q[s] > m) m = q[s];
        }
    }

    /// @notice Cost (in WAD units) to buy `sharesWad` of `outcome`.
    ///         Positive = trader pays this into the pool.
    function quoteBuy(Outcome outcome, int256 sharesWad) public view returns (int256 costWad) {
        require(sharesWad > 0, "shares must be positive");
        int256 before = _cost();

        // Simulate: add sharesWad to every state matching the outcome mask.
        int256 m = type(int256).min;
        for (uint16 s = 0; s < numStates; s++) {
            int256 qs = q[s];
            if (_matchesOutcome(s, outcome)) qs += sharesWad;
            if (qs > m) m = qs;
        }
        int256 sumExp = 0;
        for (uint16 s = 0; s < numStates; s++) {
            int256 qs = q[s];
            if (_matchesOutcome(s, outcome)) qs += sharesWad;
            sumExp += exp(wdiv(qs - m, b));
        }
        int256 after_ = m + wmul(b, ln(sumExp));
        costWad = after_ - before;
    }

    /// @notice Execute a buy of `sharesWad` of `outcome`. Caller must have
    ///         already paid/escrowed `quoteBuy` amount via your settlement
    ///         layer (payment plumbing intentionally omitted — this contract
    ///         isolates the pricing mechanism, not custody).
    function buy(Outcome outcome, int256 sharesWad) external returns (int256 costWad) {
        require(tradingOpen, "trading closed");
        costWad = quoteBuy(outcome, sharesWad);

        for (uint16 s = 0; s < numStates; s++) {
            if (_matchesOutcome(s, outcome)) {
                q[s] += sharesWad;
            }
        }

        emit Traded(msg.sender, outcome, sharesWad, uint256(costWad));
        return costWad;
    }

    // ───────────────────────── Read-only odds views ─────────────────────────

    /// @notice Current probability (WAD-scaled, sums to 1e18) of `outcome`,
    ///         derived by summing state probabilities under its mask.
    function odds(Outcome outcome) public view returns (int256) {
        int256 m = _maxQ();
        int256 sumExp = 0;
        int256 matchExp = 0;
        for (uint16 s = 0; s < numStates; s++) {
            int256 e = exp(wdiv(q[s] - m, b));
            sumExp += e;
            if (_matchesOutcome(s, outcome)) matchExp += e;
        }
        return wdiv(matchExp, sumExp);
    }

    function snapshotOdds() external returns (
        uint256 home, uint256 draw, uint256 away,
        uint256 over, uint256 under, uint256 gg, uint256 ng
    ) {
        home  = uint256(odds(Outcome.HOME));
        draw  = uint256(odds(Outcome.DRAW));
        away  = uint256(odds(Outcome.AWAY));
        over  = uint256(odds(Outcome.OVER));
        under = uint256(odds(Outcome.UNDER));
        gg    = uint256(odds(Outcome.GG));
        ng    = uint256(odds(Outcome.NG));
        emit OddsSnapshot(home, draw, away, over, under, gg, ng);
    }

    /// @notice Worst-case LP loss bound for this book: b * ln(numStates).
    ///         Callers should size `b` at deploy time so this is a sane
    ///         fraction of the backing LP pool for the market group.
    function worstCaseLossBound() external view returns (int256) {
        return wmul(b, ln(int256(uint256(numStates)) * WAD));
    }

    function closeTrading() external onlyAdmin {
        tradingOpen = false;
    }

    // ───────────────────────── Fixed-point math (WAD, 1e18) ─────────────────────────
    // Minimal, self-contained exp/ln for demo purposes. Range-reduced Taylor
    // series; adequate precision for this contract's domain but NOT a
    // general-purpose fixed-point library. Swap for a vetted library
    // (e.g. PRBMath / Solmate FixedPointMathLib) before any real deployment.

    int256 internal constant LN2_WAD = 693147180559945309; // ln(2) * 1e18

    function wmul(int256 x, int256 y) internal pure returns (int256) {
        return (x * y) / WAD;
    }

    function wdiv(int256 x, int256 y) internal pure returns (int256) {
        return (x * WAD) / y;
    }

    /// @dev exp(x), x is WAD-scaled. Range-reduces via x = k*ln2 + r,
    ///      exp(x) = 2^k * exp(r), Taylor series for r in [-ln2/2, ln2/2].
    function exp(int256 x) internal pure returns (int256) {
        if (x == 0) return WAD;
        bool neg = x < 0;
        if (neg) x = -x;

        int256 k = x / LN2_WAD;
        int256 r = x - k * LN2_WAD; // 0 <= r < LN2_WAD

        // Taylor series for exp(r/1e18): 1 + r + r^2/2! + ... (10 terms)
        int256 term = WAD;
        int256 sum = WAD;
        for (uint256 i = 1; i <= 12; i++) {
            term = wmul(term, r) / int256(i);
            sum += term;
        }

        // multiply by 2^k
        int256 result = sum;
        if (k > 0) {
            require(k < 64, "exp overflow"); // domain guard for this demo
            result = result << uint256(k);
        }

        return neg ? wdiv(WAD, result) : result;
    }

    /// @dev ln(x), x is WAD-scaled and must be > 0. Range-reduces by
    ///      repeatedly dividing by 2 to bring x into [1, 2), then
    ///      ln(x) = k*ln2 + ln(x/2^k), Taylor series (via atanh identity
    ///      for faster convergence near 1) for the remainder.
    function ln(int256 x) internal pure returns (int256) {
        require(x > 0, "ln domain");
        int256 k = 0;
        while (x >= 2 * WAD) {
            x = x / 2;
            k++;
        }
        while (x < WAD) {
            x = x * 2;
            k--;
        }
        // x now in [1e18, 2e18). Use z = (x-1)/(x+1), ln(x) = 2*(z + z^3/3 + z^5/5 + ...)
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
