import React, { useMemo, useState } from 'react'
import { Copy, LogOut, Wallet, ExternalLink, Loader2 } from 'lucide-react'
import { useMagicSession } from '@/hooks/useMagicSession'
import { cn } from '@/lib/utils'

const navLinks = ['Live', 'Pre-Match', 'Outrights', 'My Bets', 'Results']

export default function TopNav({ activeNav, setActiveNav }) {
  const { isLoggedIn, isLoading, address, shortAddress, balanceEth, connect, logout, showWallet, hasConfig } = useMagicSession()
  const [copyState, setCopyState] = useState('idle')

  const walletLabel = useMemo(() => {
    if (!hasConfig) return 'Magic not configured'
    if (isLoggedIn) return shortAddress || 'Wallet connected'
    return 'Connect wallet'
  }, [hasConfig, isLoggedIn, shortAddress])

  const handleCopy = async () => {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      setCopyState('copied')
      window.setTimeout(() => setCopyState('idle'), 1200)
    } catch {
      setCopyState('error')
      window.setTimeout(() => setCopyState('idle'), 1200)
    }
  }

  return (
    <header className="sticky top-0 z-50 bg-canvas border-b border-light-pearl h-[60px] flex items-center px-6 lg:px-10">
      <div className="flex items-center gap-2 mr-8 shrink-0">
        <span className="text-lg">TB</span>
        <span className="font-inter font-bold text-lg text-midnight tracking-tight">TradeBook</span>
      </div>

      <nav className="hidden md:flex items-center gap-1 flex-1 justify-center">
        {navLinks.map((link) => (
          <button
            key={link}
            onClick={() => setActiveNav(link)}
            className={cn(
              'font-inter text-[15px] px-4 py-[18px] relative transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-midnight/30 rounded-md',
              activeNav === link ? 'text-midnight font-semibold' : 'text-dark-shale hover:text-midnight'
            )}
          >
            {link}
            {activeNav === link && (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-[2px] bg-midnight rounded-full" />
            )}
          </button>
        ))}
      </nav>

      <div className="flex items-center gap-3 ml-auto shrink-0">
        {isLoggedIn && (
          <div className="hidden lg:flex items-center gap-2 bg-cloud-whisper border border-light-pearl rounded-full px-3 py-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="font-inter text-[12px] text-dark-shale">{balanceEth} ETH</span>
          </div>
        )}

        {isLoggedIn && address && (
          <div className="hidden xl:flex items-center gap-2 bg-slate-mist border border-light-pearl rounded-full px-3 py-1.5">
            <span className="font-inter text-[12px] font-medium text-midnight">{shortAddress}</span>
            <button
              onClick={handleCopy}
              className="text-silver-ash hover:text-midnight transition-colors"
              aria-label="Copy wallet address"
              title={copyState === 'copied' ? 'Copied' : 'Copy address'}
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <button
          onClick={isLoggedIn ? showWallet : connect}
          disabled={isLoading || !hasConfig}
          className="inline-flex items-center gap-2 font-inter text-sm font-medium text-midnight border border-midnight px-4 py-1.5 rounded-[20px] hover:bg-midnight hover:text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
          <span>{isLoading ? 'Loading' : walletLabel}</span>
        </button>

        {isLoggedIn ? (
          <>
            <button
              onClick={showWallet}
              className="hidden sm:inline-flex items-center gap-2 font-inter text-sm font-medium text-midnight border border-light-pearl bg-cloud-whisper px-4 py-1.5 rounded-[20px] hover:border-midnight hover:bg-slate-mist transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              Wallet
            </button>
            <button
              onClick={logout}
              className="hidden sm:inline-flex items-center gap-2 font-inter text-sm font-medium text-dark-shale border border-light-pearl px-4 py-1.5 rounded-[20px] hover:text-midnight hover:border-midnight transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Disconnect
            </button>
          </>
        ) : null}
      </div>
    </header>
  )
}
