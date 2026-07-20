import {
  getCoreContract,
  getLiquidityVaultContract,
  getReadProvider,
  hasContractAddresses,
  ODDS_PRECISION,
} from '@/lib/contracts'

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
}

const ODDS_COLUMNS = [
  { key: '1', label: '1' },
  { key: 'X', label: 'X' },
  { key: '2', label: '2' },
  { key: 'O2.5', label: 'O2.5' },
  { key: 'U2.5', label: 'U2.5' },
  { key: 'GG', label: 'GG' },
  { key: 'NG', label: 'NG' },
]

const MARKET_COLUMN_MAP = {
  'All Markets': null,
  '1X2': ['1', 'X', '2'],
  'Over/Under': ['O2.5', 'U2.5'],
  'Both Teams to Score': ['GG', 'NG'],
}

const ODDS_LABEL_MAP = {
  '1': 'Home Win',
  X: 'Draw',
  '2': 'Away Win',
  'O2.5': 'Over 2.5',
  'U2.5': 'Under 2.5',
  GG: 'Both Score',
  NG: 'No Both Score',
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

function formatOddsNumber(raw) {
  if (raw == null) return 0
  const odds = Number(raw) / Number(ODDS_PRECISION)
  return Number.isFinite(odds) ? odds : 0
}

function splitGroupTitle(title) {
  const cleaned = String(title || '').trim().replace(/\s+/g, ' ')
  if (!cleaned) return { home: 'Home', away: 'Away' }

  const patterns = [
    /^(.*?)\s+vs\.?\s+(.*)$/i,
    /^(.*?)\s+v\s+(.*)$/i,
    /^(.*?)\s+-\s+(.*)$/i,
  ]

  for (const pattern of patterns) {
    const match = cleaned.match(pattern)
    if (match) {
      return { home: match[1].trim() || 'Home', away: match[2].trim() || 'Away' }
    }
  }

  return { home: cleaned, away: 'Away' }
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
    exists: Boolean(raw[7]),
    pricingInitialized: Boolean(raw[8]),
    pricingB: raw[9] ?? 0n,
    homeScore: toNumber(raw[10]),
    awayScore: toNumber(raw[11]),
    resultFinalized: Boolean(raw[12]),
    settlementProofHash: raw[13] || '',
  }
}

function parseMarketMeta(raw) {
  if (!raw) return null
  return {
    marketId: toNumber(raw[0]),
    creator: raw[1],
    startTime: toNumber(raw[2]),
    status: toNumber(raw[3]),
    numOutcomes: toNumber(raw[4]),
    maxDeviationBps: raw[5] ?? 0n,
    oddsLastUpdated: toNumber(raw[6]),
    oddsProofHash: raw[7] || '',
    exposure: raw[8] ?? 0n,
    settlementTime: toNumber(raw[9]),
    winningOutcome: toNumber(raw[10]),
    title: raw[11] || '',
    description: raw[12] || '',
    category: toNumber(raw[13]),
    groupId: toNumber(raw[14]),
    hasGroup: Boolean(raw[15]),
    groupMarketIndex: toNumber(raw[16]),
    marketType: toNumber(raw[17]),
    settlementRule: toNumber(raw[18]),
    settlementLine: toNumber(raw[19]),
    homeOutcomeId: toNumber(raw[20]),
    drawOutcomeId: toNumber(raw[21]),
    awayOutcomeId: toNumber(raw[22]),
    yesOutcomeId: toNumber(raw[23]),
    noOutcomeId: toNumber(raw[24]),
    overOutcomeId: toNumber(raw[25]),
    underOutcomeId: toNumber(raw[26]),
    epochId: toNumber(raw[27]),
    settledInEpoch: Boolean(raw[28]),
    backing: raw[29] ?? 0n,
    lockedPayout: raw[30] ?? 0n,
  }
}

function parseMarketSlipView(raw) {
  if (!raw) return null
  return {
    status: toNumber(raw[0]),
    startTime: toNumber(raw[1]),
    numOutcomes: toNumber(raw[2]),
    epochId: toNumber(raw[3]),
    groupId: toNumber(raw[4]),
    marketType: toNumber(raw[5]),
    currentOdds: Array.from(raw[6] || []),
    volumeCap: Array.from(raw[7] || []),
    volumeFilled: Array.from(raw[8] || []),
    slipVolumeFilled: Array.from(raw[9] || []),
    winningOutcome: toNumber(raw[10]),
  }
}

function buildMarketCard(group, market, slipView) {
  const currentOdds = Array.from({ length: slipView?.numOutcomes || market.numOutcomes || 0 }, (_, index) => slipView?.currentOdds?.[index] ?? 0n)
  const maxOdd = currentOdds.reduce((acc, odd) => Math.max(acc, formatOddsNumber(odd)), 0)
  const status = slipView ? slipView.status : market.status
  const startTime = slipView?.startTime || market.startTime
  const marketType = slipView?.marketType ?? market.marketType
  const winningOutcome = slipView?.winningOutcome ?? market.winningOutcome

  return {
    id: `${group.groupId}-${market.marketId}`,
    marketId: market.marketId,
    groupId: group.groupId,
    title: market.title || MARKET_NAMES[marketType] || `Market ${market.groupMarketIndex + 1}`,
    description: market.description,
    marketType,
    marketName: MARKET_NAMES[marketType] || `Type ${marketType}`,
    status: STATUS_NAMES[status] || `Status ${status}`,
    time: formatTime(startTime),
    startTime,
    currentOdds,
    maxOdd,
    winningOutcome,
    volumeCap: slipView?.volumeCap || [],
    volumeFilled: slipView?.volumeFilled || [],
    slipVolumeFilled: slipView?.slipVolumeFilled || [],
    raw: market,
  }
}

function buildLiveMatchCard(group) {
  const primaryMarket = group.markets.find((market) => market.marketType === 0) || group.markets[0]
  const { home, away } = splitGroupTitle(group.title)
  const odds = primaryMarket
    ? {
        '1': formatOddsNumber(primaryMarket.currentOdds?.[0]),
        X: formatOddsNumber(primaryMarket.currentOdds?.[1]),
        '2': formatOddsNumber(primaryMarket.currentOdds?.[2]),
      }
    : { '1': 0, X: 0, '2': 0 }

  return {
    id: `group-${group.groupId}`,
    league: 'Football',
    minute: group.resultFinalized
      ? `FT ${group.homeScore}-${group.awayScore}`
      : group.eventStartTime
        ? new Date(group.eventStartTime * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'Pre-match',
    home,
    away,
    homeScore: group.homeScore ?? 0,
    awayScore: group.awayScore ?? 0,
    odds,
    groupId: group.groupId,
    marketId: primaryMarket?.marketId ?? 0,
    marketStatus: primaryMarket?.status || 'Open',
    markets: group.markets,
  }
}

function buildMarketTabs(groups) {
  const tabs = new Set(['All Markets'])
  for (const group of groups) {
    for (const market of group.markets || []) {
      if (market.marketType === 0) tabs.add('1X2')
      if (market.marketType === 1) tabs.add('Over/Under')
      if (market.marketType === 2) tabs.add('Both Teams to Score')
    }
  }
  return Array.from(tabs)
}

function buildSportsCategories(groups) {
  return groups.length > 0 ? [{ icon: 'football', name: 'Football', count: groups.length }] : []
}

function buildPopularLeagues(groups) {
  return groups.slice(0, 8).map((group) => ({ flag: 'football', name: group.title || `Group ${group.groupId}` }))
}

function buildMatchesByLeague(groups) {
  const matches = groups.map(buildLiveMatchCard)
  return matches.length ? [{ league: 'Football', matches }] : []
}

function buildStats(groups, currentEpoch, lpNav) {
  const markets = groups.flatMap((group) => group.markets)
  const openCount = markets.filter((market) => market.status === 1).length
  const soonCount = markets.filter((market) => market.startTime && market.startTime > Date.now() / 1000 && market.startTime - Date.now() / 1000 < 3600).length
  const highestOdd = markets.reduce((acc, market) => Math.max(acc, market.maxOdd || 0), 0)

  return [
    { icon: 'stats', label: 'Total Markets', value: String(markets.length) },
    { icon: 'live', label: 'Live Events', value: String(openCount) },
    { icon: 'soon', label: 'Starting Soon (1hr)', value: String(soonCount) },
    { icon: 'odds', label: 'Highest Odds', value: highestOdd ? highestOdd.toFixed(2) : '?' },
    { icon: 'epoch', label: 'Current Epoch', value: currentEpoch ? String(currentEpoch) : '?' },
    { icon: 'nav', label: 'LP NAV', value: lpNav ? (Number(lpNav) / Number(ODDS_PRECISION)).toFixed(4) : '?' },
  ]
}

function canonicalGroupKey(group) {
  const title = String(group.title || '').trim().toLowerCase().replace(/\s+/g, ' ')
  const start = String(group.eventStartTime || 0)
  return `${title}|${start}`
}

function chooseBetterGroup(existing, candidate) {
  const existingMarkets = existing.markets?.length || 0
  const candidateMarkets = candidate.markets?.length || 0
  const existingScore = (existing.pricingInitialized ? 1000 : 0) + existingMarkets * 100 + (existing.resultFinalized ? 10 : 0)
  const candidateScore = (candidate.pricingInitialized ? 1000 : 0) + candidateMarkets * 100 + (candidate.resultFinalized ? 10 : 0)
  return candidateScore > existingScore ? candidate : existing
}

function dedupeGroups(groups) {
  const byKey = new Map()
  for (const group of groups) {
    const key = canonicalGroupKey(group)
    const current = byKey.get(key)
    if (!current) {
      byKey.set(key, group)
      continue
    }
    byKey.set(key, chooseBetterGroup(current, group))
  }
  return Array.from(byKey.values()).sort((a, b) => a.groupId - b.groupId)
}

async function loadChainSnapshot(provider, walletAddress) {
  const core = getCoreContract(provider)
  const vault = getLiquidityVaultContract(provider)
  if (!core) return null

  const [currentEpochRaw, nextGroupIdRaw, nextMarketIdRaw, lpNav, lpStats, totalLpShares] = await Promise.all([
    core.currentEpoch(),
    core.nextGroupId(),
    core.nextMarketId(),
    vault?.lpNav?.() ?? 0n,
    walletAddress && vault?.getLPStats ? vault.getLPStats(walletAddress) : Promise.resolve(null),
    vault?.totalLpShares?.() ?? 0n,
  ])

  const groupCount = Math.max(0, toNumber(nextGroupIdRaw) - 1)
  const groupIds = Array.from({ length: Math.min(groupCount, MAX_GROUP_SCAN) }, (_, index) => index + 1)
  const groups = []
  const maxMarketId = toNumber(nextMarketIdRaw)

  for (const groupId of groupIds) {
    const rawGroup = parseGroup(await core.marketGroups(groupId))
    if (!rawGroup || !rawGroup.exists) continue

    const markets = []
    for (let marketId = 1; marketId < maxMarketId; marketId += 1) {
      const [metaRaw, slipRaw] = await Promise.all([
        core.markets(BigInt(marketId)),
        core.getMarketSlipView(BigInt(marketId)),
      ])
      const marketMeta = parseMarketMeta(metaRaw)
      if (!marketMeta || marketMeta.groupId !== groupId) continue
      const slipView = parseMarketSlipView(slipRaw)
      markets.push(buildMarketCard(rawGroup, marketMeta, slipView))
    }

    groups.push({
      ...rawGroup,
      markets,
      label: rawGroup.title || `Group ${groupId}`,
      status: rawGroup.resultFinalized ? 'Settled' : 'Live',
    })
  }

  const uniqueGroups = dedupeGroups(groups)
  const liveMatches = uniqueGroups.map(buildLiveMatchCard)

  return {
    source: 'chain',
    currentEpoch: toNumber(currentEpochRaw),
    groups: uniqueGroups,
    liveMatches,
    matchesByLeague: buildMatchesByLeague(uniqueGroups),
    marketTabs: buildMarketTabs(uniqueGroups),
    sportsCategories: buildSportsCategories(uniqueGroups),
    popularLeagues: buildPopularLeagues(uniqueGroups),
    betHistory: [],
    oddsColumns: ODDS_COLUMNS,
    marketColumnMap: MARKET_COLUMN_MAP,
    oddsLabelMap: ODDS_LABEL_MAP,
    marketsByGroup: Object.fromEntries(uniqueGroups.map((group) => [group.groupId, group.markets])),
    stats: buildStats(uniqueGroups, toNumber(currentEpochRaw), lpNav),
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
}

export async function fetchDashboardSnapshot({ provider = getReadProvider(), walletAddress } = {}) {
  const fallback = {
    source: 'empty',
    currentEpoch: 0,
    groups: [],
    liveMatches: [],
    matchesByLeague: [],
    marketTabs: [],
    sportsCategories: [],
    popularLeagues: [],
    betHistory: [],
    oddsColumns: ODDS_COLUMNS,
    marketColumnMap: MARKET_COLUMN_MAP,
    oddsLabelMap: ODDS_LABEL_MAP,
    marketsByGroup: {},
    stats: buildStats([], 0, 0n),
    lpStats: null,
  }

  if (!hasContractAddresses()) return fallback

  try {
    const chainData = await loadChainSnapshot(provider, walletAddress)
    return chainData || fallback
  } catch (error) {
    return { ...fallback, error }
  }
}

export function canLoadContractSnapshot() {
  return hasContractAddresses()
}

