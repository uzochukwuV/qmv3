import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useMagicSession } from '@/hooks/useMagicSession'
import { canLoadContractSnapshot, fetchDashboardSnapshot } from '@/lib/contractDashboard'
import { getReadProvider } from '@/lib/contracts'

export function useContractDashboard() {
  const { address, ethersProvider, isLoggedIn } = useMagicSession()

  const provider = useMemo(() => ethersProvider || getReadProvider(), [ethersProvider])

  const query = useQuery({
    queryKey: ['dashboard-snapshot', address || 'anon'],
    queryFn: () => fetchDashboardSnapshot({ provider, walletAddress: isLoggedIn ? address : null }),
    staleTime: 30_000,
    refetchInterval: 45_000,
  })

  return {
    ...query,
    hasContracts: canLoadContractSnapshot(),
    walletAddress: address,
    isWalletConnected: isLoggedIn,
    currentEpoch: query.data?.currentEpoch || 0,
    groups: query.data?.groups || [],
    marketsByGroup: query.data?.marketsByGroup || {},
    stats: query.data?.stats || [],
    lpStats: query.data?.lpStats || null,
    uiData: query.data || null,
  }
}
