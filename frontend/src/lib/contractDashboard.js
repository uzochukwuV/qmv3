import {
  getBetSlipsContract,
  getCoreContract,
  getLiquidityVaultContract,
  getReadProvider,
  hasContractAddresses,
  ODDS_PRECISION,
} from '@/lib/contracts'
import {
  liveMatches,
  marketTabs,
  matchesByLeague,
  oddsColumns,
  marketColumnMap,
  oddsLabelMap,
  sportsCategories,
  popularLeagues,
  initialBetSlip,
  betHistory,
} from '@/lib/sportsData'

const MAX_GROUP_SCAN = 64

const STATUS_NAMES = {
  0: 'PreOpen',
  1: 'Open',
  2: 'Suspended',
  3: 'AwaitingResult',
  4: 'Proposed',
  5: 'Settled',
  6: 'Voided',
}

const MARKET_NAMES = {
  0: 'FTR',
  1: 'Goals',
  2: 'BTTS',
  3: 'Asian Handicap',
  4: 'First Goal',
  5: 'Correct Score',
  6: 'HT Result',
  7: 'Player Props',
}

function toNumber(value) {
  try {
    return Number(value)
  } catch {
    return 0
  }
}

function formatTime(ts) {
  const value = toNumber(ts)
  if (!value) return ''
  return new Date(value * 1000).toLocaleString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  })
}

function formatOdds(raw) {
  if (raw == null) return '—'
  try {
    const odds = Number(raw) / Number(ODDS_PRECISION)
    return odds > 0 ? odds.toFixed(2) : '—'
  } catch {
    return '—'
  }
}

function formatOddsNumber(raw) {
  if (raw == null) return 0
  const odds = Number(raw) / Number(ODDS_PRECISION)
  return Number.isFinite(odds) ? odds : 0
}

function parseGroup(raw) {
  if (!raw) return null
  return {
    groupId: toNumber(raw[0]),
    creator: raw[1],
    title: raw[2] || '',
    eventStartTime: toNumber(raw[3]),
    maxGroupExposure: raw[4] ?? 0n,
    currentExposure: raw[5] ?? 0n,
    numMarkets: toNumber(raw[6]),
    marketIds: Array.from(raw[7] || []).map(toNumber).filter(Boolean),
    exists: Boolean(raw[8]),
    pricingInitialized: Boolean(raw[9]),
    pricingB: raw[10] ?? 0n,
    stateQ: raw[11] || [],
    homeScore: toNumber(raw[12]),
    awayScore: toNumber(raw[13]),
    resultFinalized: Boolean(raw[14]),
  }
}

function parseMarket(raw) {
  if (!raw) return null
  return {
    marketId: toNumber(raw[0]),
    creator: raw[1],
    startTime: toNumber(raw[2]),
    status: toNumber(raw[3]),
    numOutcomes: toNumber(raw[4]),
    currentOdds: raw[5] || [],
    oddsAnchor: raw[6] || [],
    maxDeviationBps: raw[7] ?? 0n,
    volumeCap: raw[8] || [],
    volumeFilled: raw[9] || [],
    slipVolumeFilled: raw[10] || [],
    oddsLastUpdated: toNumber(raw[11]),
    exposure: raw[12] ?? 0n,
    settlementTime: toNumber(raw[13]),
    winningOutcome: toNumber(raw[14]),
    title: raw[15] || '',
    description: raw[16] || '',
    category: toNumber(raw[17]),
    groupId: toNumber(raw[18]),
    hasGroup: Boolean(raw[19]),
    groupMarketIndex: toNumber(raw[20]),
    marketType: toNumber(raw[21]),
    settlementRule: toNumber(raw[22]),
    settlementLine: toNumber(raw[23]),
    homeOutcomeId: toNumber(raw[24]),
    drawOutcomeId: toNumber(raw[25]),
    awayOutcomeId: toNumber(raw[26]),
    yesOutcomeId: toNumber(raw[27]),
    noOutcomeId: toNumber(raw[28]),
    overOutcomeId: toNumber(raw[29]),
    underOutcomeId: toNumber(raw[30]),
    epochId: toNumber(raw[31]),
    settledInEpoch: Boolean(raw[32]),
    backing: raw[33] ?? 0n,
    lockedPayout: raw[34] ?? 0n,
  }
}

function buildMarketCard(group, market) {
  const currentOdds = Array.from({ length: market.numOutcomes || 0 }, (_, index) => formatOdds(market.currentOdds?.[index]))
  const maxOdd = currentOdds.reduce((acc, odd) => Math.max(acc, Number.parseFloat(odd) || 0), 0)

  return {
    id: `${group.groupId}-${market.marketId}`,
    marketId: market.marketId,
    groupId: group.groupId,
    title: market.title || MARKET_NAMES[market.marketType] || `Market ${market.groupMarketIndex + 1}`,
    description: market.description,
    marketType: MARKET_NAMES[market.marketType] || `Type ${market.marketType}`,
    status: STATUS_NAMES[market.status] || `Status ${market.status}`,
    time: formatTime(market.startTime),
    startTime: market.startTime,
    currentOdds,
    maxOdd,
    winningOutcome: market.winningOutcome,
    volumeCap: market.volumeCap,
    volumeFilled: market.volumeFilled,
    slipVolumeFilled: market.slipVolumeFilled,
    raw: market,
  }
}

function buildStats(groups, currentEpoch, lpNav) {
  const markets = groups.flatMap((group) => group.markets)
  const openCount = markets.filter((market) => market.status === 'Open').length
  const soonCount = markets.filter((market) => market.startTime && market.startTime > Date.now() / 1000 && market.startTime - Date.now() / 1000 < 3600).length
  const highestOdd = markets.reduce((acc, market) => Math.max(acc, market.maxOdd || 0), 0)

  return [
    { icon: 'stats', label: 'Total Markets Today', value: String(markets.length) },
    { icon: 'live', label: 'Live Events', value: String(openCount) },
    { icon: 'soon', label: 'Starting Soon (1hr)', value: String(soonCount) },
    { icon: 'odds', label: 'Highest Odds Today', value: highestOdd ? highestOdd.toFixed(2) : '—' },
    { icon: 'epoch', label: 'Current Epoch', value: currentEpoch ? String(currentEpoch) : '—' },
    { icon: 'nav', label: 'LP NAV', value: lpNav ? (Number(lpNav) / Number(ODDS_PRECISION)).toFixed(4) : '—' },
  ]
}

function buildUiFallback() {
  return {
    liveMatches,
    marketTabs,
    matchesByLeague,
    oddsColumns,
    marketColumnMap,
    oddsLabelMap,
    sportsCategories,
    popularLeagues,
    initialBetSlip,
    betHistory,
  }
}

function buildSnapshotEnvelope(base, chainData) {
  return {
    ...base,
    ...buildUiFallback(),
    ...chainData,
  }
}

async function loadChainSnapshot(provider, walletAddress) {
  const core = getCoreContract(provider)
  const vault = getLiquidityVaultContract(provider)
  const slips = getBetSlipsContract(provider)

  if (!core) {
    return null
  }

  const [currentEpochRaw, nextGroupIdRaw, lpNav, lpStats, totalLpShares] = await Promise.all([
    core.currentEpoch(),
    core.nextGroupId(),
    vault?.lpNav?.() ?? 0n,
    walletAddress && vault?.getLPStats ? vault.getLPStats(walletAddress) : Promise.resolve(null),
    vault?.totalLpShares?.() ?? 0n,
  ])

  const groupCount = Math.max(0, toNumber(nextGroupIdRaw) - 1)
  const groupIds = Array.from({ length: Math.min(groupCount, MAX_GROUP_SCAN) }, (_, index) => index + 1)

  const groups = []
  for (const groupId of groupIds) {
    const rawGroup = parseGroup(await core.marketGroups(groupId))
    if (!rawGroup || !rawGroup.exists) continue

    const numMarkets = rawGroup.numMarkets || toNumber(await core.getGroupNumMarkets(groupId))
    const marketIds = []
    for (let index = 0; index < numMarkets; index += 1) {
      marketIds.push(toNumber(await core.getGroupMarketId(groupId, index)))
    }

    const markets = []
    for (const marketId of marketIds) {
      const rawMarket = parseMarket(await core.markets(marketId))
      if (rawMarket) {
        markets.push(buildMarketCard(rawGroup, rawMarket))
      }
    }

    groups.push({
      ...rawGroup,
      markets,
      label: rawGroup.title || `Group ${groupId}`,
      status: rawGroup.resultFinalized ? 'Settled' : 'Live',
    })
  }

  const chainData = {
    source: 'chain',
    currentEpoch: toNumber(currentEpochRaw),
    groups,
    marketsByGroup: Object.fromEntries(groups.map((group) => [group.groupId, group.markets])),
    stats: buildStats(groups, toNumber(currentEpochRaw), lpNav),
    lpStats: lpStats
      ? {
          shares: lpStats.shares ?? lpStats[0] ?? 0n,
          totalShares: lpStats.totalShares ?? lpStats[1] ?? totalLpShares,
          nav: lpStats.nav ?? lpStats[2] ?? lpNav,
          positionValue: lpStats.positionValue ?? lpStats[3] ?? 0n,
          freeLiquidity: lpStats.freeLiquidity ?? lpStats[4] ?? 0n,
          pendingWithdrawalShares: lpStats.pendingWithdrawalShares ?? lpStats[5] ?? 0n,
          withdrawalAvailableAt: Number(lpStats.withdrawalAvailableAt ?? lpStats[6] ?? 0),
          withdrawalEpochId: Number(lpStats.withdrawalEpochId ?? lpStats[7] ?? 0),
          withdrawalPending: Boolean(lpStats.withdrawalPending ?? lpStats[8] ?? false),
          withdrawalEpochSettled: Boolean(lpStats.withdrawalEpochSettled ?? lpStats[9] ?? false),
        }
      : null,
  }

  return chainData
}

export async function fetchDashboardSnapshot({ provider = getReadProvider(), walletAddress } = {}) {
  const fallback = buildSnapshotEnvelope(
    {
      source: 'mock',
      currentEpoch: 0,
      groups: [],
      marketsByGroup: {},
      stats: buildStats([], 0, 0n),
      lpStats: null,
    },
    {}
  )

  if (!hasContractAddresses()) {
    return fallback
  }

  try {
    const chainData = await loadChainSnapshot(provider, walletAddress)
    if (!chainData) return fallback
    return buildSnapshotEnvelope(
      {
        source: 'chain',
        currentEpoch: chainData.currentEpoch,
        groups: chainData.groups,
        marketsByGroup: chainData.marketsByGroup,
        stats: chainData.stats,
        lpStats: chainData.lpStats,
      },
      {}
    )
  } catch (error) {
    return {
      ...fallback,
      source: 'fallback',
      error,
    }
  }
}

export function canLoadContractSnapshot() {
  return hasContractAddresses()
}



