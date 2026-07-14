import { useEffect, useMemo, useState } from 'react'
import { formatAddress, formatEthBalance } from '@/utils/magic'
import { useMagic } from '@/hooks/useMagic'

export function useMagicSession() {
  const magic = useMagic()
  const [balanceWei, setBalanceWei] = useState(null)
  const [balanceLoading, setBalanceLoading] = useState(false)

  const loadBalance = async () => {
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
  }

  useEffect(() => {
    loadBalance()
  }, [magic.address, magic.ethersProvider])

  const balanceEth = useMemo(() => formatEthBalance(balanceWei), [balanceWei])

  return {
    ...magic,
    balanceWei,
    balanceEth,
    balanceLoading,
    reloadBalance: loadBalance,
    shortAddress: formatAddress(magic.address),
  }
}

