import { Contract } from 'ethers'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatAddress, formatEthBalance } from '@/utils/magic'
import { useMagic } from '@/hooks/useMagic'
import { getCoreContract, getReadProvider } from '@/lib/contracts'

const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]

export function useMagicSession() {
  const magic = useMagic()
  const [balanceWei, setBalanceWei] = useState(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [mockTokenBalance, setMockTokenBalance] = useState(null)
  const [mockTokenLoading, setMockTokenLoading] = useState(false)
  const [mockTokenAddress, setMockTokenAddress] = useState(env.VITE_MOCK_TOKEN_ADDRESS || '')
  const [mockTokenDecimals, setMockTokenDecimals] = useState(Number(env.VITE_MOCK_TOKEN_DECIMALS || 6))
  const [mockTokenSymbol] = useState(env.VITE_MOCK_TOKEN_SYMBOL || 'USDC')

  const loadBalance = useCallback(async () => {
    if (!magic.ethersProvider || !magic.address) {
      setBalanceWei(null)
      return null
    }

    setBalanceLoading(true)
    try {
      const bal = await magic.ethersProvider.getBalance(magic.address)
      setBalanceWei(bal)
      return bal
    } finally {
      setBalanceLoading(false)
    }
  }, [magic.address, magic.ethersProvider])

  const loadMockTokenBalance = useCallback(async () => {
    if (!magic.address) {
      setMockTokenBalance(null)
      return null
    }

    setMockTokenLoading(true)
    try {
      const provider = magic.ethersProvider || getReadProvider()
      let tokenAddress = mockTokenAddress

      if (!tokenAddress) {
        const core = getCoreContract(provider)
        if (core?.baseToken) {
          tokenAddress = await core.baseToken()
          setMockTokenAddress(tokenAddress)
        }
      }

      if (!tokenAddress) {
        setMockTokenBalance(null)
        return null
      }

      const token = new Contract(tokenAddress, ERC20_ABI, provider)
      const [balance, decimals] = await Promise.all([
        token.balanceOf(magic.address),
        token.decimals().catch(() => mockTokenDecimals),
      ])

      setMockTokenDecimals(Number(decimals || 6))
      setMockTokenBalance(balance)
      return balance
    } finally {
      setMockTokenLoading(false)
    }
  }, [magic.address, magic.ethersProvider, mockTokenAddress, mockTokenDecimals, mockTokenSymbol])

  useEffect(() => {
    loadBalance()
  }, [loadBalance])

  useEffect(() => {
    loadMockTokenBalance()
  }, [loadMockTokenBalance])

  useEffect(() => {
    const handleTokenUpdate = () => {
      loadBalance()
      loadMockTokenBalance()
    }

    window.addEventListener('mock-token-updated', handleTokenUpdate)
    return () => window.removeEventListener('mock-token-updated', handleTokenUpdate)
  }, [loadBalance, loadMockTokenBalance])

  const balanceEth = useMemo(() => formatEthBalance(balanceWei), [balanceWei])
  const mockTokenBalanceFormatted = useMemo(() => {
    if (mockTokenBalance == null) return '0.00'
    const raw = typeof mockTokenBalance === 'bigint' ? mockTokenBalance : BigInt(mockTokenBalance.toString())
    const divisor = 10n ** BigInt(mockTokenDecimals || 6)
    const whole = raw / divisor
    const fraction = raw % divisor
    const fractionText = fraction.toString().padStart(mockTokenDecimals || 6, '0').slice(0, 2)
    return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fractionText}`
  }, [mockTokenBalance, mockTokenDecimals])

  return {
    ...magic,
    balanceWei,
    balanceEth,
    balanceLoading,
    mockTokenAddress,
    mockTokenBalance,
    mockTokenBalanceFormatted,
    mockTokenDecimals,
    mockTokenLoading,
    mockTokenSymbol,
    reloadBalance: loadBalance,
    reloadMockTokenBalance: loadMockTokenBalance,
    shortAddress: formatAddress(magic.address),
  }
}
