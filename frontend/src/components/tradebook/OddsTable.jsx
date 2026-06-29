import React, { useState } from "react";
import { matchesByLeague, oddsColumns, marketColumnMap, oddsLabelMap } from "@/lib/sportsData";
import { ChevronDown, ChevronUp } from "lucide-react";

export default function OddsTable({ activeMarket, onOddsClick, selectedOdds }) {
  const [animatingId, setAnimatingId] = useState(null);
  const [expandedMatch, setExpandedMatch] = useState(null);

  const visibleColumns = marketColumnMap[activeMarket]
    ? oddsColumns.filter((c) => marketColumnMap[activeMarket].includes(c.key))
    : oddsColumns;

  const isSelected = (matchId, market) => {
    return selectedOdds.some((o) => o.matchId === matchId && o.market === market);
  };

  const handleClick = (match, col) => {
    const id = `${match.id}-${col.key}`;
    setAnimatingId(id);
    setTimeout(() => setAnimatingId(null), 200);
    onOddsClick({
      matchId: match.id,
      match: `${match.home} vs ${match.away}`,
      selection: `${col.key} (${oddsLabelMap[col.key] || col.key})`,
      market: col.key,
      odds: match.odds[col.key],
    });
  };

  return (
    <div className="border border-light-pearl rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-slate-mist flex items-center sticky top-0 z-10">
        <div className="font-inter text-[12px] font-semibold text-silver-ash w-[60px] px-3 py-2.5 shrink-0">
          Time
        </div>
        <div className="font-inter text-[12px] font-semibold text-silver-ash flex-1 min-w-[140px] px-2 py-2.5">
          Match
        </div>
        {visibleColumns.map((col) => (
          <div
            key={col.key}
            className="font-inter text-[12px] font-semibold text-silver-ash w-[52px] text-center px-1 py-2.5 shrink-0"
          >
            {col.label}
          </div>
        ))}
        <div className="w-[44px] shrink-0" />
      </div>

      {/* Leagues */}
      {matchesByLeague.map((league) => (
        <div key={league.league}>
          <div className="bg-cloud-whisper px-4 py-2 border-b border-light-pearl">
            <span className="font-inter text-[13px] font-bold text-dark-shale">{league.league}</span>
          </div>
          {league.matches.map((match) => (
            <React.Fragment key={match.id}>
              <div className="flex items-center bg-canvas hover:bg-cloud-whisper border-b border-light-pearl transition-colors group">
                <div className="font-inter text-[12px] text-silver-ash w-[60px] px-3 py-2.5 shrink-0">
                  {match.time}
                </div>
                <div className="flex-1 min-w-[140px] px-2 py-2.5">
                  <span className="font-inter text-[14px] font-semibold text-midnight">{match.home}</span>
                  <span className="font-inter text-[13px] text-silver-ash mx-1.5">vs</span>
                  <span className="font-inter text-[14px] text-dark-shale">{match.away}</span>
                </div>
                {visibleColumns.map((col) => {
                  const btnId = `${match.id}-${col.key}`;
                  const sel = isSelected(match.id, col.key);
                  return (
                    <div key={col.key} className="w-[52px] px-1 py-1.5 shrink-0 flex justify-center">
                      <button
                        onClick={() => handleClick(match, col)}
                        className={`w-[44px] py-1 rounded font-inter text-[13px] border transition-all ${
                          sel
                            ? "bg-sunset-orange border-sunset-orange text-white font-semibold"
                            : "bg-cloud-whisper border-light-pearl text-midnight hover:border-sunset-orange hover:text-sunset-orange"
                        } ${animatingId === btnId ? "odds-pop" : ""}`}
                      >
                        {match.odds[col.key]?.toFixed(2)}
                      </button>
                    </div>
                  );
                })}
                <div className="w-[44px] shrink-0 flex items-center justify-center">
                  <button
                    onClick={() => setExpandedMatch(expandedMatch === match.id ? null : match.id)}
                    className="flex items-center gap-0.5 font-inter text-[12px] text-sunset-orange hover:underline"
                  >
                    +{match.more}
                    {expandedMatch === match.id ? (
                      <ChevronUp className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )}
                  </button>
                </div>
              </div>
              {expandedMatch === match.id && (
                <div className="bg-cloud-whisper px-6 py-4 border-b border-light-pearl">
                  <div className="font-inter text-[12px] text-silver-ash mb-2">All Markets — {match.home} vs {match.away}</div>
                  <div className="flex flex-wrap gap-2">
                    {oddsColumns.map((col) => {
                      const sel = isSelected(match.id, col.key);
                      return (
                        <button
                          key={col.key}
                          onClick={() => handleClick(match, col)}
                          className={`px-3 py-1.5 rounded-lg font-inter text-[12px] border transition-all ${
                            sel
                              ? "bg-sunset-orange border-sunset-orange text-white"
                              : "bg-canvas border-light-pearl text-midnight hover:border-sunset-orange"
                          }`}
                        >
                          <span className="text-silver-ash mr-1">{col.label}</span>
                          <span className="font-semibold">{match.odds[col.key]?.toFixed(2)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      ))}
    </div>
  );
}