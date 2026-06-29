import React, { useRef, useState } from "react";
import { liveMatches } from "@/lib/sportsData";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function LiveMatches({ onOddsClick, selectedOdds }) {
  const scrollRef = useRef(null);
  const [animatingId, setAnimatingId] = useState(null);

  const scroll = (dir) => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: dir * 300, behavior: "smooth" });
    }
  };

  const handleOddsClick = (match, market, odds) => {
    const id = `live-${match.id}-${market}`;
    setAnimatingId(id);
    setTimeout(() => setAnimatingId(null), 200);
    onOddsClick({
      matchId: match.id,
      match: `${match.home} vs ${match.away}`,
      selection: `${market} (${market === "1" ? "Home" : market === "2" ? "Away" : "Draw"})`,
      market,
      odds,
    });
  };

  const isSelected = (matchId, market) => {
    return selectedOdds.some((o) => o.matchId === matchId && o.market === market);
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500 live-pulse" />
          <h2 className="font-inter text-lg font-bold text-midnight">LIVE NOW</h2>
          <span className="bg-sunset-orange/10 text-sunset-orange font-inter text-xs font-semibold px-2.5 py-0.5 rounded-full">
            {liveMatches.length} Live
          </span>
        </div>
        <div className="flex gap-1">
          <button onClick={() => scroll(-1)} className="p-1 rounded-full hover:bg-slate-mist transition-colors">
            <ChevronLeft className="w-4 h-4 text-silver-ash" />
          </button>
          <button onClick={() => scroll(1)} className="p-1 rounded-full hover:bg-slate-mist transition-colors">
            <ChevronRight className="w-4 h-4 text-silver-ash" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex gap-3 overflow-x-auto hide-scrollbar pb-1">
        {liveMatches.map((match) => (
          <div
            key={match.id}
            className="bg-slate-mist rounded-lg p-4 min-w-[272px] shrink-0 flex flex-col"
          >
            <div className="flex items-center gap-1.5 mb-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 live-pulse" />
              <span className="font-inter text-[12px] text-silver-ash">
                {match.league} • {match.minute}
              </span>
            </div>
            <div className="font-inter text-[15px] font-bold text-midnight mb-1">
              {match.home} vs {match.away}
            </div>
            <div className="font-inter text-2xl font-bold text-sunset-orange text-center my-2">
              {match.homeScore} — {match.awayScore}
            </div>
            <div className="flex gap-2 mt-auto">
              {Object.entries(match.odds).map(([market, odds]) => {
                const btnId = `live-${match.id}-${market}`;
                const sel = isSelected(match.id, market);
                return (
                  <button
                    key={market}
                    onClick={() => handleOddsClick(match, market, odds)}
                    className={`flex-1 py-2 rounded-lg border font-inter text-[13px] font-medium transition-all ${
                      sel
                        ? "bg-sunset-orange border-sunset-orange text-white"
                        : "border-midnight/20 text-midnight hover:bg-sunset-orange hover:border-sunset-orange hover:text-white"
                    } ${animatingId === btnId ? "odds-pop" : ""}`}
                  >
                    <div className="text-[10px] opacity-60">{market}</div>
                    <div>{odds.toFixed(2)}</div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}