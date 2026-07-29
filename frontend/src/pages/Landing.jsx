import React, { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useInView, useScroll, useTransform } from "framer-motion";
import { ArrowRight, ChevronRight } from "lucide-react";

/* ─── Data ─────────────────────────────────────────────── */
const navLinks = ["Protocol", "Markets", "Liquidity", "Docs"];

const services = [
  {
    number: "01",
    title: "Fixed-Odds Pricing",
    subtitle: "Semi-Static Oracle-Priced Markets",
    text: "Odds are anchored to external consensus (Pinnacle/API) at market creation and bounded on-chain by max deviation limits. No LMSR curve — prices are set, drift is enforced, and the on-chain guarantee is verifiable without trusting any single oracle.",
    accent: "#ff682c",
  },
  {
    number: "02",
    title: "Group-Level State-Space Pricing",
    subtitle: "9-State Composite Book",
    text: "Each football match is a group of three correlated markets — 1x2, Over/Under 2.5, and GG/NG — priced from a single shared 9-state distribution. Cross-market arbitrage is structurally impossible because all odds derive from the same underlying probability model.",
    accent: "#816729",
  },
  {
    number: "03",
    title: "Epoch-Gated Liquidity",
    subtitle: "Front-Run Resistant LP Architecture",
    text: "LPs deposit USDC before an epoch opens. Deposits close when trading begins. Withdrawals are only enabled after all markets in the epoch settle, with a mandatory cooldown. This prevents liquidity manipulation around resolution events.",
    accent: "#ff682c",
  },
  {
    number: "04",
    title: "Parlay Correlation Discounts",
    subtitle: "Pairwise Discount + Cross-Match Bonus",
    text: "Multi-leg slips automatically apply correlation discounts based on GroupType and same-match status — same type same match gets the deepest discount, cross-match accumulators earn a bonus. Odds math is pure on-chain computation with no floating point.",
    accent: "#202020",
  },
  {
    number: "05",
    title: "EVM on Arbitrum Sepolia",
    subtitle: "Solidity 0.28 + Hardhat 3 + viem",
    text: "The protocol runs on Arbitrum Sepolia with Solidity 0.28, via-IR optimization, and OpenZeppelin 5.6. All contracts use custom errors, ReentrancyGuard, and SafeERC20. The modular architecture separates storage, logic, and libraries for gas efficiency.",
    accent: "#816729",
  },
  {
    number: "06",
    title: "Magic Wallet Onboarding",
    subtitle: "Embedded Wallets, No Extensions",
    text: "Users sign in with Magic embedded wallets — no browser extension required. The dashboard loads real on-chain groups, markets, odds, and LP stats. A faucet mints test USDC so anyone can try betting and LP flows immediately.",
    accent: "#202020",
  },
];

const stats = [
  { value: "Arbitrum", label: "Deployment Network" },
  { value: "3", label: "Markets Per Group" },
  { value: "8", label: "Group Types" },
  { value: "24hr", label: "Epoch Duration" },
];

const ticker = [
  "ARBITRUM SEPOLIA", "FIXED ODDS", "EPOCH LP", "MAGIC WALLET",
  "QUADRATIC MARKETS", "9-STATE PRICING", "PARLAY DISCOUNTS", "ORACLE ANCHOR",
  "REENTRANCY GUARD", "SAFEERC20",
];

const liveMarkets = [
  { question: "Arsenal vs Chelsea — 1X2?", home: "2.10", draw: "3.40", away: "3.60", vol: "12,400", close: "Pre-match" },
  { question: "Over/Under 2.5 Goals?", over: "1.85", under: "1.95", vol: "8,200", close: "Pre-match" },
  { question: "Both Teams to Score?", yes: "1.72", no: "2.10", vol: "5,600", close: "Pre-match" },
];

/* ─── Helpers ───────────────────────────────────────────── */
function FadeUp({ children, delay = 0, className = "" }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 28 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function Ticker({ items }) {
  return (
    <div className="overflow-hidden border-y border-light-pearl py-3 select-none">
      <div className="flex w-max" style={{ animation: "ticker 35s linear infinite" }}>
        {[...items, ...items].map((item, i) => (
          <span key={i} className="font-inter text-[13px] font-medium text-silver-ash px-8 shrink-0 flex items-center gap-3">
            <span className="w-1 h-1 rounded-full bg-sunset-orange inline-block" />
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function MarketRow({ market, highlight }) {
  const [sel, setSel] = useState(null);
  return (
    <div className={`flex items-center gap-3 px-5 py-3.5 border-b border-light-pearl last:border-0 ${highlight ? "bg-cloud-whisper" : ""}`}>
      <div className="flex-1 min-w-0">
        <span className="font-inter text-[13px] font-semibold text-midnight truncate block">{market.question}</span>
        <span className="font-inter text-[11px] text-silver-ash">Vol {market.vol} · {market.close}</span>
      </div>
      <div className="flex gap-1.5 shrink-0">
        {Object.entries(market).filter(([k]) => k !== "question" && k !== "vol" && k !== "close").map(([k, v]) => (
          <button
            key={k}
            onClick={() => setSel(sel === k ? null : k)}
            className={`px-3 py-1.5 rounded font-inter text-[12px] border transition-all ${
              sel === k
                ? "bg-sunset-orange border-sunset-orange text-white font-semibold"
                : "border-light-pearl text-midnight bg-cloud-whisper hover:border-sunset-orange hover:text-sunset-orange"
            }`}
          >
            <span className="text-[10px] block opacity-60">{k.toUpperCase()}</span>
            <span className="font-bold">{v}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ServiceRow({ svc, index }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const isEven = index % 2 === 0;

  return (
    <article ref={ref} className="grid md:grid-cols-2 gap-0 border-b border-light-pearl">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.7, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        className={`flex flex-col justify-center px-8 lg:px-16 py-16 ${isEven ? "md:order-1" : "md:order-2"}`}
      >
        <p className="font-inter text-[12px] font-semibold uppercase tracking-[0.15em] mb-4" style={{ color: svc.accent }}>
          {svc.subtitle}
        </p>
        <h2 className="font-inter text-[28px] lg:text-[38px] font-light text-midnight tracking-tight leading-tight mb-6">
          {svc.title}
        </h2>
        <p className="font-inter text-[15px] text-dark-shale leading-relaxed mb-8 max-w-md">
          {svc.text}
        </p>
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 font-inter text-[14px] font-medium text-midnight hover:text-sunset-orange transition-colors group"
        >
          Explore Markets
          <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
        </Link>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={inView ? { opacity: 1 } : {}}
        transition={{ duration: 0.8, delay: 0.25 }}
        className={`relative bg-slate-mist flex items-center justify-center min-h-[320px] overflow-hidden ${isEven ? "md:order-2" : "md:order-1"}`}
      >
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,104,44,0.04)_0%,transparent_60%)]" />
        <div className="flex flex-col items-center gap-3 px-8">
          <span
            className="font-inter text-[90px] lg:text-[120px] font-bold leading-none select-none"
            style={{ color: svc.accent, opacity: 0.07 }}
          >
            {svc.number}
          </span>
          {/* Mini odds card */}
          <div className="flex gap-2 mt-[-24px]">
            <div className="bg-canvas border border-light-pearl rounded-lg px-4 py-3 text-center shadow-sm min-w-[90px]">
              <div className="font-inter text-[10px] text-silver-ash mb-1">ODDS</div>
              <div className="font-inter text-[18px] font-bold text-midnight">
                {(1.5 + index * 0.3).toFixed(2)}
              </div>
              <div className="font-inter text-[9px] text-green-500 font-semibold mt-0.5">× fixed</div>
            </div>
            <div className="bg-canvas border border-light-pearl rounded-lg px-4 py-3 text-center shadow-sm min-w-[90px]">
              <div className="font-inter text-[10px] text-silver-ash mb-1">LP SHARE</div>
              <div className="font-inter text-[18px] font-bold text-midnight">
                {(0.85 + index * 0.05).toFixed(2)}
              </div>
              <div className="font-inter text-[9px] text-sunset-orange font-semibold mt-0.5">× epoch</div>
            </div>
          </div>
        </div>
      </motion.div>
    </article>
  );
}

/* ─── Main ──────────────────────────────────────────────── */
export default function Landing() {
  const heroRef = useRef(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroY = useTransform(scrollYProgress, [0, 1], ["0%", "20%"]);

  return (
    <div className="bg-canvas text-midnight font-inter overflow-x-hidden">
      <style>{`
        @keyframes ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
      `}</style>

      {/* ── NAV ── */}
      <motion.nav
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="fixed top-0 left-0 right-0 z-50 bg-canvas/90 backdrop-blur-md border-b border-light-pearl"
      >
        <div className="max-w-[1200px] mx-auto px-6 lg:px-10 h-[60px] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-midnight flex items-center justify-center">
              <span className="text-canvas text-[11px] font-bold">◈</span>
            </div>
            <span className="font-inter font-bold text-[17px] text-midnight tracking-tight">TradeBook</span>
            <span className="hidden sm:block font-inter text-[10px] font-semibold text-silver-ash border border-light-pearl rounded px-2 py-0.5 ml-1">
              on Arbitrum
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-8">
            {navLinks.map((l) => (
              <a key={l} href={`#${l.toLowerCase()}`} className="font-inter text-[14px] text-dark-shale hover:text-midnight transition-colors">
                {l}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <span className="hidden sm:flex items-center gap-1.5 font-inter text-[12px] text-silver-ash border border-light-pearl rounded-full px-3 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              Testnet
            </span>
            <Link
              to="/dashboard"
              className="font-inter text-[13px] font-semibold bg-midnight text-canvas px-5 py-2 rounded-[20px] hover:bg-midnight/85 transition-colors"
            >
              Launch App
            </Link>
          </div>
        </div>
      </motion.nav>

      {/* ── HERO ── */}
      <section ref={heroRef} className="min-h-screen flex flex-col justify-center pt-[60px] overflow-hidden">
        <motion.div
          style={{ y: heroY }}
          className="max-w-[1200px] mx-auto px-6 lg:px-10 w-full grid md:grid-cols-2 gap-16 items-center py-20"
        >
          {/* Left */}
          <div>
            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="font-inter text-[12px] font-semibold text-sunset-orange uppercase tracking-[0.18em] mb-6"
            >
              EVM Fixed-Odds Sports Betting
            </motion.p>

            <motion.h1
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.75, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="font-inter text-[44px] lg:text-[64px] font-light text-midnight tracking-tight leading-[1.05] mb-8"
            >
              Decentralized
              <br />
              <span className="relative inline-block">
                Prediction
                <motion.span
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.6, delay: 0.85, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute bottom-0 left-0 right-0 h-[3px] bg-sunset-orange origin-left block"
                />
              </span>
              <br />
              Markets
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              className="font-inter text-[16px] lg:text-[18px] font-medium text-dark-shale leading-relaxed mb-10 max-w-[480px]"
            >
              A contract-backed sports betting protocol on Arbitrum Sepolia with fixed odds,
              epoch-gated liquidity provision, and Magic embedded wallet onboarding —
              all settled in USDC.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.62 }}
              className="flex flex-wrap gap-4"
            >
              <Link
                to="/dashboard"
                className="group inline-flex items-center gap-2 bg-midnight text-canvas font-inter font-semibold text-[14px] px-7 py-3.5 rounded-[20px] hover:bg-midnight/85 transition-all"
              >
                Trade Markets
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <a
                href="#protocol"
                className="inline-flex items-center gap-2 border border-midnight/20 text-midnight font-inter font-medium text-[14px] px-7 py-3.5 rounded-[20px] hover:border-midnight/50 transition-colors"
              >
                Read Protocol
              </a>
            </motion.div>

            {/* Chain badges */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.9 }}
              className="flex items-center gap-3 mt-8"
            >
              {["Arbitrum", "Sepolia", "Fixed Odds", "Epoch LP"].map((badge) => (
                <span key={badge} className="font-inter text-[11px] font-medium text-silver-ash border border-light-pearl rounded px-2.5 py-1">
                  {badge}
                </span>
              ))}
            </motion.div>
          </div>

          {/* Right — live markets widget */}
          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="relative"
          >
            <div className="bg-canvas border border-light-pearl rounded-[8px] shadow-[0_8px_40px_rgba(0,0,0,0.08)] overflow-hidden">
              <div className="bg-slate-mist px-5 py-3 flex items-center justify-between border-b border-light-pearl">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  <span className="font-inter text-[12px] font-semibold text-dark-shale uppercase tracking-wider">Live Markets</span>
                </div>
                <span className="font-inter text-[11px] text-silver-ash bg-sunset-orange/10 text-sunset-orange font-semibold px-2 py-0.5 rounded-full">
                  USDC
                </span>
              </div>
              {liveMarkets.map((m, i) => (
                <MarketRow key={i} market={m} highlight={i === 0} />
              ))}
              <div className="px-5 py-3 border-t border-light-pearl">
                <Link to="/dashboard" className="font-inter text-[12px] text-sunset-orange font-semibold hover:underline flex items-center gap-1">
                  View all markets <ChevronRight className="w-3 h-3" />
                </Link>
              </div>
            </div>

            {/* Epoch badge */}
            <motion.div
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1.0, duration: 0.5 }}
              className="absolute -top-4 -right-4 bg-midnight text-canvas rounded-[8px] shadow-lg px-4 py-2.5"
            >
              <div className="font-inter text-[11px] text-canvas/60">Current Epoch</div>
              <div className="font-inter text-[16px] font-bold text-canvas">#1</div>
            </motion.div>
          </motion.div>
        </motion.div>
      </section>

      {/* ── MARKET TICKER ── */}
      <Ticker items={ticker} />

      {/* ── STATS ── */}
      <section className="max-w-[1200px] mx-auto px-6 lg:px-10 py-20 grid grid-cols-2 md:grid-cols-4 gap-8 border-b border-light-pearl">
        {stats.map(({ value, label }, i) => (
          <FadeUp key={label} delay={i * 0.08}>
            <div className="text-[32px] lg:text-[42px] font-light text-midnight tracking-tight leading-none mb-2">
              {value}
            </div>
            <div className="font-inter text-[13px] font-medium text-silver-ash">{label}</div>
          </FadeUp>
        ))}
      </section>

      {/* ── PROTOCOL FEATURES ── */}
      <section id="protocol" className="border-t border-light-pearl">
        <div className="max-w-[1200px] mx-auto px-6 lg:px-10 py-16">
          <FadeUp>
            <p className="font-inter text-[12px] font-semibold text-sunset-orange uppercase tracking-[0.18em] mb-4">
              Protocol Architecture
            </p>
            <h2 className="font-inter text-[32px] lg:text-[48px] font-light text-midnight tracking-tight leading-tight max-w-lg">
              Built for on-chain fixed-odds betting
            </h2>
          </FadeUp>
        </div>
        <div className="border-t border-light-pearl">
          {services.map((svc, i) => (
            <ServiceRow key={svc.number} svc={svc} index={i} />
          ))}
        </div>
      </section>

      {/* ── LP CTA ── */}
      <section id="liquidity" className="max-w-[1200px] mx-auto px-6 lg:px-10 py-24">
        <div className="bg-slate-mist rounded-[8px] p-12 lg:p-20 grid md:grid-cols-2 gap-12 items-center">
          <FadeUp>
            <p className="font-inter text-[12px] font-semibold text-sunset-orange uppercase tracking-[0.18em] mb-5">
              Liquidity Provision
            </p>
            <h2 className="font-inter text-[32px] lg:text-[44px] font-light text-midnight tracking-tight leading-tight mb-6">
              Provide liquidity. Earn protocol fees.
            </h2>
            <p className="font-inter text-[15px] text-dark-shale leading-relaxed mb-6 max-w-md">
              Deposit USDC into epoch-gated LP vaults to back fixed-odds markets. Earn a share
              of protocol trading fees with front-run protection built into every epoch cycle.
            </p>
            <ul className="space-y-3 mb-8">
              {[
                "Epoch-gated deposits prevent oracle manipulation",
                "Fixed odds with on-chain deviation enforcement",
                "Winning legs from lost slips flow to the LP pool",
              ].map((item) => (
                <li key={item} className="flex items-center gap-3 font-inter text-[14px] text-dark-shale">
                  <span className="w-1.5 h-1.5 rounded-full bg-sunset-orange shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
            <div className="flex gap-4 flex-wrap">
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-2 bg-midnight text-canvas font-inter font-semibold text-[14px] px-7 py-3.5 rounded-[20px] hover:bg-midnight/85 transition-colors group"
              >
                Deposit USDC
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <a
                href="#protocol"
                className="inline-flex items-center gap-2 border border-midnight/20 text-midnight font-inter font-medium text-[14px] px-7 py-3.5 rounded-[20px] hover:border-midnight/50 transition-colors"
              >
                LP Docs
              </a>
            </div>
          </FadeUp>

          <FadeUp delay={0.15}>
            <div className="space-y-4">
              {[
                { label: "Epoch Duration", value: "24 hours", sub: "Configurable per epoch" },
                { label: "Cooling Period", value: "24 hours", sub: "Pre-resolution lockout" },
                { label: "LP Fee Share", value: "0.3% / trade", sub: "Distributed at epoch close", highlight: true },
                { label: "Max Deviation", value: "5%", sub: "On-chain anchor enforcement", highlight: false },
              ].map((row) => (
                <div
                  key={row.label}
                  className={`flex items-center justify-between px-5 py-4 rounded-[8px] border ${
                    row.highlight ? "border-sunset-orange bg-sunset-orange/5" : "border-light-pearl bg-canvas"
                  }`}
                >
                  <div>
                    <div className="font-inter text-[14px] font-semibold text-midnight">{row.label}</div>
                    <div className="font-inter text-[12px] text-silver-ash">{row.sub}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`font-inter text-[14px] font-bold ${row.highlight ? "text-sunset-orange" : "text-midnight"}`}>
                      {row.value}
                    </span>
                    <ChevronRight className="w-4 h-4 text-silver-ash" />
                  </div>
                </div>
              ))}
            </div>
          </FadeUp>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-light-pearl px-6 lg:px-10 py-10">
        <div className="max-w-[1200px] mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-midnight flex items-center justify-center">
              <span className="text-canvas text-[8px] font-bold">◈</span>
            </div>
            <span className="font-inter font-bold text-[15px] text-midnight">TradeBook</span>
          </div>
          <p className="font-inter text-[12px] text-silver-ash text-center">
            © 2026 TradeBook. Open-source. Built on Arbitrum. Settled in USDC. Not financial advice.
          </p>
          <div className="flex gap-6 font-inter text-[13px] text-dark-shale">
            <a href="#" className="hover:text-midnight transition-colors">GitHub</a>
            <a href="#" className="hover:text-midnight transition-colors">Docs</a>
            <a href="#" className="hover:text-midnight transition-colors">Discord</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
