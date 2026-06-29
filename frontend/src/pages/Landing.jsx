import React, { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, useInView, useScroll, useTransform } from "framer-motion";
import { ArrowRight, ChevronRight } from "lucide-react";

/* ─── Data ─────────────────────────────────────────────────── */
const navLinks = ["Protocol", "Markets", "Liquidity", "Docs"];

const services = [
  {
    number: "01",
    title: "LMSR Pricing Engine",
    subtitle: "Logistic Market Scoring Rule",
    text: "Odds and prices are computed on-chain via the Logarithmic Market Scoring Rule. Initial USDC seeding establishes market liquidity depth, with dynamic repricing as positions are taken — ensuring fair, manipulation-resistant outcomes at every epoch.",
    accent: "#ff682c",
  },
  {
    number: "02",
    title: "P2P Limit Order Book",
    subtitle: "Polymarket-Style On-Chain Trading",
    text: "All trades settle peer-to-peer through a transparent on-chain limit order book. Place, fill, or cancel orders without interacting with the AMM pool directly — protecting liquidity while enabling deep price discovery.",
    accent: "#816729",
  },
  {
    number: "03",
    title: "Multi-Bet LP Hedging",
    subtitle: "Quadratic Protection for Liquidity Providers",
    text: "When a multi-leg slip is submitted, each leg is routed to its individual market. Partial wins flow to the LP pool. Full wins trigger a protocol bonus. Full losses are absorbed by the LP — creating a balanced, sustainable hedging mechanism.",
    accent: "#202020",
  },
  {
    number: "04",
    title: "Epoch-Based Liquidity",
    subtitle: "Front-Run Resistant LP Architecture",
    text: "Deposit and withdrawal operations are gated by configurable epochs with mandatory cooling periods. This prevents liquidity manipulation around resolution events and ensures LPs commit capital with full protocol-level protection.",
    accent: "#ff682c",
  },
  {
    number: "05",
    title: "USDC Settlement",
    subtitle: "Native Solana SPL Token Accounting",
    text: "All positions, payouts, and LP shares are denominated in USDC on Solana. Settlement is atomic, gas-minimal, and fully on-chain — no custodial risk, no wrapped assets, no intermediaries.",
    accent: "#816729",
  },
  {
    number: "06",
    title: "On-Chain Resolution",
    subtitle: "Trustless Outcome Oracle Integration",
    text: "Markets resolve through a decentralized oracle layer anchored to Solana programs. Disputed outcomes enter a community arbitration phase before final settlement — ensuring no single party controls resolution.",
    accent: "#202020",
  },
];

const stats = [
  { value: "$4.2M+", label: "Total Value Locked" },
  { value: "2,800+", label: "Open Markets" },
  { value: "120K+", label: "On-Chain Positions" },
  { value: "99.98%", label: "Protocol Uptime" },
];

const ticker = [
  "SOL/USDC", "BTC Dominance", "ETH Merge Outcome", "BONK Launch",
  "PYTH/USDC", "Solana TPS Record", "JTO Airdrop", "WIF ATH",
  "Firedancer Mainnet", "USDC Depeg Risk",
];

const liveMarkets = [
  { question: "Will SOL reach $300 by EOQ?", yes: "0.62", no: "0.38", vol: "$48,200", close: "14d" },
  { question: "BTC halving above $80K?",      yes: "0.71", no: "0.29", vol: "$91,500", close: "6d" },
  { question: "ETH ETF approval in 2025?",    yes: "0.54", no: "0.46", vol: "$32,800", close: "21d" },
];

/* ─── Helpers ───────────────────────────────────────────────── */
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
        <span className="font-inter text-[11px] text-silver-ash">Vol {market.vol} · Closes in {market.close}</span>
      </div>
      <div className="flex gap-1.5 shrink-0">
        {[{ k: "yes", label: "YES", val: market.yes }, { k: "no", label: "NO", val: market.no }].map((c) => (
          <button
            key={c.k}
            onClick={() => setSel(sel === c.k ? null : c.k)}
            className={`px-3 py-1.5 rounded font-inter text-[12px] border transition-all ${
              sel === c.k
                ? "bg-sunset-orange border-sunset-orange text-white font-semibold"
                : "border-light-pearl text-midnight bg-cloud-whisper hover:border-sunset-orange hover:text-sunset-orange"
            }`}
          >
            <span className="text-[10px] block opacity-60">{c.label}</span>
            <span className="font-bold">{c.val}</span>
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
          Read Docs
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
          {/* Mini prediction card */}
          <div className="flex gap-2 mt-[-24px]">
            <div className="bg-canvas border border-light-pearl rounded-lg px-4 py-3 text-center shadow-sm min-w-[90px]">
              <div className="font-inter text-[10px] text-silver-ash mb-1">YES</div>
              <div className="font-inter text-[18px] font-bold text-midnight">
                {(0.48 + index * 0.05).toFixed(2)}
              </div>
              <div className="font-inter text-[9px] text-green-500 font-semibold mt-0.5">▲ USDC</div>
            </div>
            <div className="bg-canvas border border-light-pearl rounded-lg px-4 py-3 text-center shadow-sm min-w-[90px]">
              <div className="font-inter text-[10px] text-silver-ash mb-1">NO</div>
              <div className="font-inter text-[18px] font-bold text-midnight">
                {(1 - (0.48 + index * 0.05)).toFixed(2)}
              </div>
              <div className="font-inter text-[9px] text-red-400 font-semibold mt-0.5">▼ USDC</div>
            </div>
          </div>
        </div>
      </motion.div>
    </article>
  );
}

/* ─── Main ───────────────────────────────────────────────────── */
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
            <span className="font-inter font-bold text-[17px] text-midnight tracking-tight">PredX</span>
            <span className="hidden sm:block font-inter text-[10px] font-semibold text-silver-ash border border-light-pearl rounded px-2 py-0.5 ml-1">
              on Solana
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
              Mainnet Beta
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
              Solana Prediction Market Protocol
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
              A Solana-native protocol with LMSR quadratic pricing, P2P limit order trading,
              and epoch-based liquidity provision — all settled in USDC.
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
              {["Solana", "USDC", "LMSR", "P2P LOB"].map((badge) => (
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
                  View all 2,800+ markets <ChevronRight className="w-3 h-3" />
                </Link>
              </div>
            </div>

            {/* TVL badge */}
            <motion.div
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1.0, duration: 0.5 }}
              className="absolute -bottom-5 -left-6 bg-canvas border border-light-pearl rounded-[8px] shadow-lg px-4 py-3 flex items-center gap-3"
            >
              <div className="w-8 h-8 rounded-full bg-sunset-orange/10 flex items-center justify-center">
                <span className="font-inter text-[10px] font-bold text-sunset-orange">$</span>
              </div>
              <div>
                <div className="font-inter text-[11px] text-silver-ash">Total Value Locked</div>
                <div className="font-inter text-[14px] font-bold text-midnight">$4.2M USDC</div>
              </div>
            </motion.div>

            {/* Epoch badge */}
            <motion.div
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1.1, duration: 0.5 }}
              className="absolute -top-4 -right-4 bg-midnight text-canvas rounded-[8px] shadow-lg px-4 py-2.5"
            >
              <div className="font-inter text-[11px] text-canvas/60">Current Epoch</div>
              <div className="font-inter text-[16px] font-bold text-canvas">#2847</div>
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
              Built for on-chain prediction markets
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
              Deposit USDC into epoch-gated LP vaults to hedge multi-bet slips and earn a share of
              protocol trading fees — with front-run protection built into every epoch cycle.
            </p>
            <ul className="space-y-3 mb-8">
              {[
                "Epoch-gated deposits prevent oracle manipulation",
                "Multi-bet hedging generates baseline LP yield",
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
                { label: "Epoch Duration", value: "72 hours", sub: "Configurable per market" },
                { label: "Cooling Period", value: "6 hours", sub: "Pre-resolution lockout" },
                { label: "LP Fee Share", value: "0.3% / trade", sub: "Distributed at epoch close", highlight: true },
                { label: "Multi-Bet Bonus", value: "2× stake", sub: "All-legs-win payout" },
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
            <span className="font-inter font-bold text-[15px] text-midnight">PredX Protocol</span>
          </div>
          <p className="font-inter text-[12px] text-silver-ash text-center">
            © 2026 PredX. Open-source. Built on Solana. Settled in USDC. Not financial advice.
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