import React, { useMemo, useState } from 'react'

const CONTRACT_MARKET_NAMES = {
  0: '1X2',
  1: 'O/U 2.5',
  2: 'GG / NG',
}

const CONTRACT_OUTCOME_LABELS = {
  0: ['1', 'X', '2'],
  1: ['O2.5', 'U2.5'],
  2: ['GG', 'NG'],
}

const CONTRACT_TAB_MARKET_TYPES = {
  'All Markets': null,
  '1X2': 0,
  'Over/Under': 1,
  'Both Teams to Score': 2,
}

const MARKET_COLUMN_CONFIG = [
  { marketType: 0, labels: ['1', 'X', '2'] },
  { marketType: 1, labels: ['O2.5', 'U2.5'] },
  { marketType: 2, labels: ['GG', 'NG'] },
]

function formatContractOdd(value) {
  const n = Number(value) / 1_000_000
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : '-'
}

function marketSort(a, b) {
  return (a.raw?.groupMarketIndex ?? a.groupMarketIndex ?? 0) - (b.raw?.groupMarketIndex ?? b.groupMarketIndex ?? 0)
}

function outcomeIndexFor(marketType, outcomeLabel) {
  const labels = CONTRACT_OUTCOME_LABELS[marketType] || []
  return labels.indexOf(outcomeLabel)
}

export default function OddsTable({ activeMarket, onOddsClick, selectedOdds, groups = [] }) {
  const [animatingId, setAnimatingId] = useState(null)

  const contractGroups = useMemo(() => {
    const tabFilter = CONTRACT_TAB_MARKET_TYPES[activeMarket]
    return groups
      .map((group) => ({
        ...group,
        markets: [...(group.markets || [])]
          .sort(marketSort)
          .filter((market) => tabFilter == null || market.marketType === tabFilter),
      }))
      .filter((group) => group.markets.length > 0)
  }, [groups, activeMarket])

  const isSelected = (matchId, market) =>
    selectedOdds.some((o) => o.matchId === matchId && o.market === market)

  const handleContractClick = (group, market, outcomeIndex, outcomeLabel) => {
    const id = `${group.groupId}-${market.marketId}-${outcomeLabel}`
    setAnimatingId(id)
    setTimeout(() => setAnimatingId(null), 200)

    onOddsClick({
      matchId: group.groupId,
      groupId: group.groupId,
      marketId: market.marketId,
      outcomeIndex,
      match: group.title || `Group ${group.groupId}`,
      selection: `${outcomeLabel} (${CONTRACT_MARKET_NAMES[market.marketType] || market.title || `Market ${market.groupMarketIndex + 1}`})`,
      market: `${market.marketId}:${outcomeLabel}`,
      odds: Number(market.currentOdds?.[outcomeIndex] || 0) / 1_000_000,
      marketTitle: market.title,
      marketType: market.marketType,
      marketStatus: market.status,
      outcomeLabel,
    })
  }

  if (contractGroups.length === 0) {
    return (
      <div className="border border-light-pearl rounded-lg overflow-hidden bg-cloud-whisper px-4 py-6 text-sm text-silver-ash">
        No on-chain markets available yet.
      </div>
    )
  }

  const visibleMarketColumns = MARKET_COLUMN_CONFIG.filter((col) => {
    const tabFilter = CONTRACT_TAB_MARKET_TYPES[activeMarket]
    return tabFilter == null || tabFilter === col.marketType
  })

  return (
    <div className="border border-light-pearl rounded-lg overflow-hidden">
      <div className="bg-slate-mist flex items-stretch sticky top-0 z-10 border-b border-light-pearl">
        <div className="w-[80px] px-3 py-2.5 shrink-0 font-inter text-[12px] font-semibold text-silver-ash">Time</div>
        <div className="flex-1 min-w-[180px] px-3 py-2.5 font-inter text-[12px] font-semibold text-silver-ash">Match</div>
        {visibleMarketColumns.map((col) => (
          <div key={col.marketType} className="flex-1 min-w-[220px] px-2 py-2.5">
            <div className="font-inter text-[12px] font-semibold text-silver-ash">{CONTRACT_MARKET_NAMES[col.marketType]}</div>
            <div className="mt-1 flex gap-1.5">
              {col.labels.map((label) => (
                <div key={label} className="flex-1 text-center font-inter text-[11px] text-silver-ash opacity-80">
                  {label}
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="w-[120px] px-2 py-2.5 shrink-0 text-right font-inter text-[12px] font-semibold text-silver-ash">Status</div>
      </div>

      {contractGroups.map((group) => {
        const marketByType = new Map(group.markets.map((market) => [market.marketType, market]))

        return (
          <div key={group.groupId} className="flex items-stretch bg-canvas hover:bg-cloud-whisper border-b border-light-pearl transition-colors">
            <div className="w-[80px] px-3 py-2.5 shrink-0 font-inter text-[12px] text-silver-ash">
              {group.eventStartTime ? new Date(group.eventStartTime * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'}
            </div>

            <div className="flex-1 min-w-[180px] px-3 py-2.5">
              <div className="font-inter text-[14px] font-semibold text-midnight">{group.title || `Group ${group.groupId}`}</div>
              <div className="font-inter text-[12px] text-silver-ash">
                {group.markets.length} markets - {group.resultFinalized ? `Final ${group.homeScore}-${group.awayScore}` : `Exposure ${group.currentExposure ? 'live' : 'open'}`}
              </div>
            </div>

            {visibleMarketColumns.map((col) => {
              const market = marketByType.get(col.marketType)
              return (
                <div key={col.marketType} className="flex-1 min-w-[220px] px-2 py-2.5">
                  {market ? (
                    <div className="space-y-1.5 rounded-lg border border-light-pearl bg-cloud-whisper p-2">
                      <div className="font-inter text-[11px] text-silver-ash">{market.title || CONTRACT_MARKET_NAMES[market.marketType]}</div>
                      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${col.labels.length}, minmax(0, 1fr))` }}>
                        {col.labels.map((outcomeLabel) => {
                          const outcomeIndex = outcomeIndexFor(market.marketType, outcomeLabel)
                          const btnId = `${group.groupId}-${market.marketId}-${outcomeLabel}`
                          const sel = isSelected(group.groupId, `${market.marketId}:${outcomeLabel}`)
                          const odds = market.currentOdds?.[outcomeIndex]

                          return (
                            <button
                              key={outcomeLabel}
                              onClick={() => handleContractClick(group, market, outcomeIndex, outcomeLabel)}
                              className={`min-w-0 px-2 py-2 rounded-lg border font-inter text-[12px] transition-all ${
                                sel
                                  ? 'bg-sunset-orange border-sunset-orange text-white font-semibold'
                                  : 'bg-cloud-whisper border-light-pearl text-midnight hover:border-sunset-orange hover:text-sunset-orange'
                              } ${animatingId === btnId ? 'odds-pop' : ''}`}
                            >
                              <div className="text-[10px] opacity-60">{outcomeLabel}</div>
                              <div className="font-semibold">{formatContractOdd(odds)}</div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="h-full rounded-lg border border-dashed border-light-pearl bg-cloud-whisper/60 px-2 py-3 text-center font-inter text-[11px] text-silver-ash">
                      N/A
                    </div>
                  )}
                </div>
              )
            })}

            <div className="w-[120px] px-2 py-2.5 shrink-0 text-right">
              <div className="font-inter text-[12px] font-semibold text-midnight">{group.status || 'Live'}</div>
              <div className="font-inter text-[11px] text-silver-ash">Group #{group.groupId}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

