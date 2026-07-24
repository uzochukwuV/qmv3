import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  getMagicClient,
  getMagicEthersProvider,
  getMagicEthereumAddress,
  hasMagicConfig,
} from '@/lib/magic'

const MagicContext = createContext(null)

async function resolveMagicAddress(client, userInfo) {
  const fromInfo = getMagicEthereumAddress(userInfo)
  if (fromInfo) return fromInfo

  try {
    const provider = getMagicEthersProvider(client)
    if (!provider) return null
    const signer = await provider.getSigner()
    return await signer.getAddress()
  } catch {
    return null
  }
}

export function MagicProvider({ children }) {
  const [magic, setMagic] = useState(null)
  const [isReady, setIsReady] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [userInfo, setUserInfo] = useState(null)
  const [address, setAddress] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    const client = getMagicClient()
    setMagic(client)

    if (!client) {
      setIsReady(false)
      setIsLoading(false)
      setError(new Error('Magic API key is not configured'))
      return
    }

    let cancelled = false

    const bootstrap = async () => {
      try {
        const loggedIn = await client.user.isLoggedIn()
        if (cancelled) return

        setIsLoggedIn(loggedIn)
        setIsReady(true)

        if (loggedIn) {
          const info = await client.user.getInfo()
          if (cancelled) return

          setUserInfo(info)
          setAddress(await resolveMagicAddress(client, info))
        } else {
          setUserInfo(null)
          setAddress(null)
        }
      } catch (err) {
        if (cancelled) return
        setError(err)
        setIsLoggedIn(false)
        setUserInfo(null)
        setAddress(null)
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    bootstrap()

    return () => {
      cancelled = true
    }
  }, [])

  const connect = useCallback(async () => {
    const client = magic || getMagicClient()
    if (!client) {
      throw new Error('Magic API key is not configured')
    }

    setIsLoading(true)
    setError(null)

    try {
      await client.wallet.connectWithUI()
      const info = await client.user.getInfo()
      setMagic(client)
      setUserInfo(info)
      setAddress(await resolveMagicAddress(client, info))
      setIsLoggedIn(true)
      setIsReady(true)
      return info
    } finally {
      setIsLoading(false)
    }
  }, [magic])

  const logout = useCallback(async () => {
    const client = magic || getMagicClient()
    if (!client) return

    setIsLoading(true)
    try {
      await client.user.logout()
      setIsLoggedIn(false)
      setUserInfo(null)
      setAddress(null)
    } finally {
      setIsLoading(false)
    }
  }, [magic])

  const showWallet = useCallback(async () => {
    const client = magic || getMagicClient()
    if (!client) {
      throw new Error('Magic API key is not configured')
    }

    await client.wallet.showUI()
  }, [magic])

  const refresh = useCallback(async () => {
    const client = magic || getMagicClient()
    if (!client) return null

    setIsLoading(true)
    try {
      const loggedIn = await client.user.isLoggedIn()
      setIsLoggedIn(loggedIn)
      setIsReady(true)

      if (!loggedIn) {
        setUserInfo(null)
        setAddress(null)
        return null
      }

      const info = await client.user.getInfo()
      setUserInfo(info)
      setAddress(await resolveMagicAddress(client, info))
      return info
    } finally {
      setIsLoading(false)
    }
  }, [magic])

  const ethersProvider = useMemo(() => getMagicEthersProvider(magic), [magic, isReady])

  const value = useMemo(
    () => ({
      magic,
      ethersProvider,
      isReady: isReady && hasMagicConfig(),
      isLoading,
      isLoggedIn,
      userInfo,
      address,
      error,
      connect,
      logout,
      showWallet,
      refresh,
      hasConfig: hasMagicConfig(),
    }),
    [
      magic,
      ethersProvider,
      isReady,
      isLoading,
      isLoggedIn,
      userInfo,
      address,
      error,
      connect,
      logout,
      showWallet,
      refresh,
    ]
  )

  return <MagicContext.Provider value={value}>{children}</MagicContext.Provider>
}

export function useMagic() {
  const context = useContext(MagicContext)
  if (!context) {
    throw new Error('useMagic must be used within a MagicProvider')
  }
  return context
}
