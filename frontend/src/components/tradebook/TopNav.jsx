import React from "react";

const navLinks = ["Live", "Pre-Match", "Outrights", "My Bets", "Results"];

export default function TopNav({ activeNav, setActiveNav }) {
  return (
    <header className="sticky top-0 z-50 bg-canvas border-b border-light-pearl h-[60px] flex items-center px-6 lg:px-10">
      <div className="flex items-center gap-2 mr-8 shrink-0">
        <span className="text-lg">⚽</span>
        <span className="font-inter font-bold text-lg text-midnight tracking-tight">TradeBook</span>
      </div>

      <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
        {navLinks.map((link) => (
          <button
            key={link}
            onClick={() => setActiveNav(link)}
            className={`font-inter text-[15px] px-4 py-[18px] relative transition-colors ${
              activeNav === link
                ? "text-midnight font-semibold"
                : "text-dark-shale hover:text-midnight"
            }`}
          >
            {link}
            {activeNav === link && (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-[2px] bg-midnight rounded-full" />
            )}
          </button>
        ))}
      </nav>

      <div className="flex items-center gap-3 ml-auto shrink-0">
        <div className="bg-sunset-orange/10 px-4 py-1.5 rounded-full">
          <span className="font-inter text-sm font-semibold text-sunset-orange">₦ 45,200.00</span>
        </div>
        <button className="hidden sm:block font-inter text-sm font-medium text-midnight border border-midnight px-5 py-1.5 rounded-[20px] hover:bg-midnight hover:text-white transition-colors">
          Deposit
        </button>
      </div>
    </header>
  );
}