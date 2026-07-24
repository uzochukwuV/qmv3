import React, { useEffect, useMemo, useState } from 'react'
import { X, Loader2, Droplets } from 'lucide-react'

const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {}
const API_BASE = env.VITE_BOT_API_URL || 'http://127.0.0.1:8787'
const PURPOSES = [
  { key: 'betting', label: 'Betting', description: 'Daily USDC for trading and slips' },
  { key: 'lp', label: 'LP', description: 'Daily USDC for liquidity provisioning' },
]

function formatTime(ts) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}

export default function FaucetModal({
  open,
  onClose,
  address,
  tokenSymbol = 'USDC',
  tokenBalanceFormatted = '0.00',
  tokenBalanceLoading = false,
  reloadMockTokenBalance,
}) {
  const [purpose, setPurpose] = useState('betting')
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const selectedPurpose = useMemo(() => PURPOSES.find((item) => item.key === purpose) || PURPOSES[0], [purpose])

  useEffect(() => {
    let cancelled = false
    async function loadStatus() {
      if (!open || !address) {
        setStatus(null)
        return
      }
      try {
        const response = await fetch(`${API_BASE}/api/faucet/status?address=${encodeURIComponent(address)}`)
        const data = await response.json()
        if (!cancelled) setStatus(data)
      } catch (error) {
        if (!cancelled) setStatus({ ok: false, error: error?.message || 'Unable to load faucet status' })
      }
    }
    loadStatus()
    return () => {
      cancelled = true
    }
  }, [address, open])

  if (!open) return null

  const claim = async () => {
    if (!address) {
      setMessage('Connect a wallet first.')
      return
    }
    setLoading(true)
    setMessage('')
    try {
      const response = await fetch(`${API_BASE}/api/faucet/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, purpose }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || 'Faucet claim failed')
      }
      setMessage(`Claimed ${Number(data.amountFormatted).toLocaleString()} ${data.tokenSymbol || tokenSymbol}`)
      setStatus((prev) => ({ ...(prev || {}), ...data, ok: true, canClaim: false }))
      await reloadMockTokenBalance?.()
      window.dispatchEvent(new Event('mock-token-updated'))
    } catch (error) {
      setMessage(error?.message || 'Faucet claim failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4">
      <div className="w-full max-w-lg rounded-2xl border border-light-pearl bg-canvas shadow-xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-light-pearl px-5 py-4">
          <div className="flex items-center gap-2">
            <Droplets className="w-4 h-4 text-sunset-orange" />
            <div>
              <div className="font-inter text-[15px] font-semibold text-midnight">Faucet</div>
              <div className="font-inter text-[12px] text-silver-ash">Mint mock {tokenSymbol} for testing</div>
            </div>
          </div>
          <button onClick={onClose} className="text-silver-ash hover:text-midnight">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="rounded-xl bg-cloud-whisper border border-light-pearl p-3">
            <div className="text-[12px] text-silver-ash">Wallet</div>
            <div className="font-mono text-[13px] text-midnight break-all">{address || 'No wallet connected'}</div>
            <div className="mt-2 text-[12px] text-silver-ash">
              Balance: <span className="text-midnight font-semibold">{tokenBalanceLoading ? 'Loading...' : `${tokenBalanceFormatted} ${tokenSymbol}`}</span>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {PURPOSES.map((item) => (
              <button
                key={item.key}
                onClick={() => setPurpose(item.key)}
                className={`rounded-xl border px-3 py-3 text-left transition-colors ${purpose === item.key ? 'border-midnight bg-slate-mist' : 'border-light-pearl bg-white hover:border-midnight/40'}`}
              >
                <div className="font-inter text-[13px] font-semibold text-midnight">{item.label}</div>
                <div className="text-[12px] text-silver-ash">{item.description}</div>
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-light-pearl bg-cloud-whisper p-3 text-[12px] text-silver-ash">
            Selected amount: <span className="text-midnight font-semibold">{status?.amounts?.[purpose] ?? (selectedPurpose.key === 'lp' ? '100000' : '5000')} {tokenSymbol}</span>
          </div>

          {status ? (
            <div className="rounded-xl border border-light-pearl bg-white p-3 text-[12px] text-silver-ash space-y-1">
              <div>Can claim: <span className="text-midnight font-semibold">{status.canClaim ? 'Yes' : 'No'}</span></div>
              <div>Last claim: <span className="text-midnight font-semibold">{formatTime(status.lastClaimAt)}</span></div>
              <div>Next eligible: <span className="text-midnight font-semibold">{formatTime(status.nextEligibleAt)}</span></div>
              {status.lastTxHash ? <div className="break-all">Last tx: <span className="text-midnight font-mono">{status.lastTxHash}</span></div> : null}
            </div>
          ) : null}

          {message ? <div className="rounded-xl bg-slate-mist px-3 py-2 text-[12px] text-midnight">{message}</div> : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-light-pearl px-5 py-4">
          <button onClick={onClose} className="rounded-full border border-light-pearl px-4 py-2 text-sm text-dark-shale hover:border-midnight hover:text-midnight">
            Close
          </button>
          <button
            onClick={claim}
            disabled={loading || !address}
            className="inline-flex items-center gap-2 rounded-full bg-midnight px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Claim {selectedPurpose.label}
          </button>
        </div>
      </div>
    </div>
  )
}

