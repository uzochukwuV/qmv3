import React, { useMemo, useState } from "react";
import {
  matchesByLeague as defaultMatchesByLeague,
  oddsColumns as defaultOddsColumns,
  marketColumnMap as defaultMarketColumnMap,
  oddsLabelMap as defaultOddsLabelMap,
} from "@/lib/sportsData";
import { ChevronDown, ChevronUp } from "lucide-react";

const CONTRACT_MARKET_NAMES = {
  0: "1X2",
  1: "O/U 2.5",
  2: "GG / NG",
};

const CONTRACT_OUTCOME_LABELS = {
  0: ["1", "X", "2"],
  1: ["O2.5", "U2.5"],
  2: ["GG", "NG"],
};

function formatContractOdd(value) {
  const n = Number(value) / 1_000_000
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : "—";
}

function isContractGroup(group) {
  return Boolean(group && Array.isArray(group.markets));
}

export default function OddsTable({
  activeMarket,
  onOddsClick,
  selectedOdds,
  leagues = defaultMatchesByLeague,
  columns = defaultOddsColumns,
  columnMap = defaultMarketColumnMap,
  labelMap = defaultOddsLabelMap,
  groups = [],
}) {
  const [animatingId, setAnimatingId] = useState(null);
  const [expandedMatch, setExpandedMatch] = useState(null);

  const visibleColumns = columnMap[activeMarket]
    ? columns.filter((c) => columnMap[activeMarket].includes(c.key))
    : columns;

  const isSelected = (matchId, market) => {
    return selectedOdds.some((o) => o.matchId === matchId && o.market === market);
  };

  const handleLegacyClick = (match, col) => {
    const id = `${match.id}-${col.key}`;
    setAnimatingId(id);
    setTimeout(() => setAnimatingId(null), 200);
    onOddsClick({
      matchId: match.id,
      match: `${match.home} vs ${match.away}`,
      selection: `${col.key} (${labelMap[col.key] || col.key})`,
      market: col.key,
      odds: match.odds[col.key],
    });
  };

  const handleContractClick = (group, market, outcomeIndex, outcomeLabel) => {
    const id = `${group.groupId}-${market.marketId}-${outcomeLabel}`;
    setAnimatingId(id);
    setTimeout(() => setAnimatingId(null), 200);
    onOddsClick({
      matchId: group.groupId,
      groupId: group.groupId,
      marketId: market.marketId,
      match: group.title || `Group ${group.groupId}`,
      selection: `${outcomeLabel} (${CONTRACT_MARKET_NAMES[market.marketType] || market.title || `Market ${market.groupMarketIndex + 1}`})`,
      market: `${market.marketId}:${outcomeLabel}`,
      odds: Number(market.currentOdds?.[outcomeIndex] || 0) / 1_000_000,
      marketTitle: market.title,
      marketType: market.marketType,
      outcomeLabel,
    });
  };

  const contractGroups = useMemo(() => groups.filter(isContractGroup), [groups]);
  const useContractView = contractGroups.length > 0;

  if (useContractView) {
    return (
      <div className="border border-light-pearl rounded-lg overflow-hidden">
        <div className="bg-slate-mist flex items-center sticky top-0 z-10">
          <div className="font-inter text-[12px] font-semibold text-silver-ash w-[80px] px-3 py-2.5 shrink-0">
            Time
          </div>
          <div className="font-inter text-[12px] font-semibold text-silver-ash flex-1 min-w-[200px] px-2 py-2.5">
            Match
          </div>
          <div className="font-inter text-[12px] font-semibold text-silver-ash w-[120px] px-2 py-2.5 text-right shrink-0">
            Status
          </div>
          <div className="w-[44px] shrink-0" />
        </div>

        {contractGroups.map((group) => {
          const markets = [...group.markets].sort((a, b) => (a.raw?.groupMarketIndex ?? a.index) - (b.raw?.groupMarketIndex ?? b.index))
          const isExpanded = expandedMatch === group.groupId

          return (
            <React.Fragment key={group.groupId}>
              <div className="flex items-center bg-canvas hover:bg-cloud-whisper border-b border-light-pearl transition-colors group">
                <div className="font-inter text-[12px] text-silver-ash w-[80px] px-3 py-2.5 shrink-0">
                  {group.eventStartTime ? new Date(group.eventStartTime * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                </div>
                <div className="flex-1 min-w-[200px] px-2 py-2.5">
                  <div className="font-inter text-[14px] font-semibold text-midnight">{group.title || `Group ${group.groupId}`}</div>
                  <div className="font-inter text-[12px] text-silver-ash">
                    {markets.length} markets • {group.resultFinalized ? `Final ${group.homeScore}-${group.awayScore}` : `Exposure ${group.currentExposure ? 'live' : 'open'}`}
                  </div>
                </div>
                <div className="w-[120px] px-2 py-2.5 text-right shrink-0">
                  <div className="font-inter text-[12px] font-semibold text-midnight">{group.status || 'Live'}</div>
                  <div className="font-inter text-[11px] text-silver-ash">Group #{group.groupId}</div>
                </div>
                <div className="w-[44px] shrink-0 flex items-center justify-center">
                  <button
                    onClick={() => setExpandedMatch(isExpanded ? null : group.groupId)}
                    className="flex items-center gap-0.5 font-inter text-[12px] text-sunset-orange hover:underline"
                    aria-label={isExpanded ? 'Collapse match markets' : 'Expand match markets'}
                  >
                    {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                </div>
              </div>

              <div className={`border-b border-light-pearl ${isExpanded ? 'block' : 'block'}`}>
                <div className="bg-cloud-whisper px-4 py-3 space-y-3">
                  {markets.slice(0, 3).map((market) => {
                    const labels = CONTRACT_OUTCOME_LABELS[market.marketType] || Array.from({ length: market.numOutcomes || 0 }, (_, i) => `O${i + 1}`)
                    const marketName = CONTRACT_MARKET_NAMES[market.marketType] || market.title || `Market ${market.groupMarketIndex + 1}`

                    return (
                      <div key={market.marketId} className="grid grid-cols-[180px_1fr] gap-3 items-center rounded-lg border border-light-pearl bg-canvas px-3 py-2">
                        <div>
                          <div className="font-inter text-[13px] font-semibold text-midnight">{marketName}</div>
                          <div className="font-inter text-[11px] text-silver-ash">
                            {market.status} • {market.startTime ? new Date(market.startTime * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 justify-end">
                          {labels.map((outcomeLabel, outcomeIndex) => {
                            const btnId = `${group.groupId}-${market.marketId}-${outcomeLabel}`;
                            const sel = isSelected(group.groupId, `${market.marketId}:${outcomeLabel}`)
                            return (
                              <button
                                key={outcomeLabel}
                                onClick={() => handleContractClick(group, market, outcomeIndex, outcomeLabel)}
                                className={`min-w-[86px] px-3 py-2 rounded-lg border font-inter text-[13px] transition-all ${
                                  sel
                                    ? "bg-sunset-orange border-sunset-orange text-white font-semibold"
                                    : "bg-cloud-whisper border-light-pearl text-midnight hover:border-sunset-orange hover:text-sunset-orange"
                                } ${animatingId === btnId ? "odds-pop" : ""}`}
                              >
                                <div className="text-[10px] opacity-60">{outcomeLabel}</div>
                                <div>{formatContractOdd(market.currentOdds?.[outcomeIndex])}</div>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </React.Fragment>
          )
        })}
      </div>
    )
  }

  return (
    <div className="border border-light-pearl rounded-lg overflow-hidden">
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

      {leagues.map((league) => (
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
                        onClick={() => handleLegacyClick(match, col)}
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
                    {columns.map((col) => {
                      const sel = isSelected(match.id, col.key);
                      return (
                        <button
                          key={col.key}
                          onClick={() => handleLegacyClick(match, col)}
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
