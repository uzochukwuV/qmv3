import React, { useCallback, useMemo, useReducer } from 'react'
import TopNav from '@/components/tradebook/TopNav'
import StatsBar from '@/components/tradebook/StatsBar'
import Sidebar from '@/components/tradebook/Sidebar'
import LiveMatches from '@/components/tradebook/LiveMatches'
import MarketTabs from '@/components/tradebook/MarketTabs'
import OddsTable from '@/components/tradebook/OddsTable'
import BetSlip from '@/components/tradebook/BetSlip'
import { useContractDashboard } from '@/hooks/useContractDashboard'
import { Loader2 } from 'lucide-react'

const initialState = {
  activeNav: 'Pre-Match',
  activeSport: 'Football',
  activeMarket: 'All Markets',
  betSlip: [],
}

function selectionKeyFor(selection) {
  return selection.selectionKey || `${selection.matchId}:${selection.market}`
}

function marketKeyFor(selection) {
  if (selection.marketId != null) return `${selection.matchId}:${selection.marketId}`
  return selection.marketKey || selection.market || `${selection.matchId}:${selection.market}`
}

function normalizeSelection(selection) {
  return {
    id: selection.id || `bet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    selectionKey: selectionKeyFor(selection),
    marketKey: marketKeyFor(selection),
    ...selection,
  }
}

function dashboardReducer(state, action) {
  switch (action.type) {
    case 'SET_NAV':
      return { ...state, activeNav: action.value }
    case 'SET_SPORT':
      return { ...state, activeSport: action.value }
    case 'SET_MARKET':
      return { ...state, activeMarket: action.value }
    case 'TOGGLE_BET': {
      const nextSelection = normalizeSelection(action.value)
      const key = nextSelection.selectionKey
      const marketKey = nextSelection.marketKey
      const sameSelection = state.betSlip.find((bet) => bet.selectionKey === key)
      if (sameSelection) {
        return {
          ...state,
          betSlip: state.betSlip.filter((bet) => bet.selectionKey !== key),
        }
      }
      const sameMarket = state.betSlip.find((bet) => bet.marketKey === marketKey)
      if (sameMarket) {
        return {
          ...state,
          betSlip: [
            ...state.betSlip.filter((bet) => bet.marketKey !== marketKey),
            nextSelection,
          ],
        }
      }
      return {
        ...state,
        betSlip: [...state.betSlip, nextSelection],
      }
    }
    case 'REMOVE_BET':
      return {
        ...state,
        betSlip: state.betSlip.filter((bet) => bet.id !== action.value),
      }
    case 'CLEAR_BETS':
      return {
        ...state,
        betSlip: [],
      }
    default:
      return state
  }
}

export default function Dashboard() {
  const {
    uiData,
    isLoading,
    walletAddress,
    currentEpoch,
    mockTokenBalanceFormatted,
    mockTokenSymbol,
    mockTokenLoading,
  } = useContractDashboard()
  const dashboardData = uiData || {}
  const [state, dispatch] = useReducer(dashboardReducer, initialState)

  const selectedOdds = useMemo(
    () => state.betSlip.map((bet) => ({ matchId: bet.matchId, market: bet.market })),
    [state.betSlip],
  )

  const handleOddsClick = useCallback((selection) => {
    dispatch({ type: 'TOGGLE_BET', value: selection })
  }, [])

  const handleRemoveBet = useCallback((id) => {
    dispatch({ type: 'REMOVE_BET', value: id })
  }, [])

  const handleClearSlip = useCallback(() => {
    dispatch({ type: 'CLEAR_BETS' })
  }, [])

  return (
    <div className="h-screen flex flex-col bg-canvas overflow-hidden font-inter">
      <TopNav
        activeNav={state.activeNav}
        setActiveNav={(value) => dispatch({ type: 'SET_NAV', value })}
      />
      <StatsBar stats={dashboardData.stats || []} />

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-sunset-orange" />
            <span className="font-inter text-[14px] text-silver-ash">
              Loading on-chain market snapshot...
            </span>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <Sidebar
            activeSport={state.activeSport}
            setActiveSport={(value) => dispatch({ type: 'SET_SPORT', value })}
            sportsCategories={dashboardData.sportsCategories || []}
            popularLeagues={dashboardData.popularLeagues || []}
          />

          <main className="flex-1 overflow-y-auto px-4 lg:px-6 py-4">
            <LiveMatches
              onOddsClick={handleOddsClick}
              selectedOdds={selectedOdds}
              matches={dashboardData.liveMatches || []}
            />
            <MarketTabs
              activeMarket={state.activeMarket}
              setActiveMarket={(value) => dispatch({ type: 'SET_MARKET', value })}
              tabs={dashboardData.marketTabs || []}
            />
            <OddsTable
              activeMarket={state.activeMarket}
              onOddsClick={handleOddsClick}
              selectedOdds={selectedOdds}
              leagues={dashboardData.matchesByLeague || []}
              columns={dashboardData.oddsColumns || []}
              columnMap={dashboardData.marketColumnMap || {}}
              labelMap={dashboardData.oddsLabelMap || {}}
              groups={dashboardData.groups || []}
            />
          </main>

          <BetSlip
            bets={state.betSlip}
            history={dashboardData.betHistory || []}
            onRemoveBet={handleRemoveBet}
            onClearSlip={handleClearSlip}
            tokenBalanceFormatted={mockTokenBalanceFormatted}
            tokenBalanceLoading={mockTokenLoading}
            tokenSymbol={mockTokenSymbol}
            walletAddress={walletAddress}
            currentEpoch={currentEpoch}
          />
        </div>
      )}
    </div>
  )
}
