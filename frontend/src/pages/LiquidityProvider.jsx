import React, { useEffect, useMemo, useState } from 'react'
import { Contract } from 'ethers'
import TopNav from '@/components/tradebook/TopNav'
import { useContractDashboard } from '@/hooks/useContractDashboard'
import { CONTRACT_ADDRESSES, getCoreContract, getLiquidityVaultContract, getReadProvider } from '@/lib/contracts'
import { parseUnits } from 'ethers'

const ERC20_WRITE_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
]

const VAULT_WRITE_ABI = [
  'function addLiquidity(uint256 amount) external',
  'function requestWithdraw(uint256 shares) external',
  'function processWithdrawal() external',
  'function withdrawalCooldownSeconds() view returns (uint256)',
]

function formatOdds(raw) {
  const value = Number(raw || 0)
  if (!value) return '—'
  return (value / 1_000_000).toFixed(2)
}

function formatDateTime(ts) {
  const value = Number(ts || 0)
  if (!value) return '—'
  return new Date(value * 1000).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function pick(raw, index, key) {
  if (!raw) return undefined
  if (raw[key] !== undefined) return raw[key]
  return raw[index]
}

function parseEpoch(raw) {
  if (!raw) return null
  return {
    epochId: Number(pick(raw, 0, 'epochId') || 0),
    startTime: Number(pick(raw, 1, 'startTime') || 0),
    endTime: Number(pick(raw, 2, 'endTime') || 0),
    totalLiquidityAdded: pick(raw, 3, 'totalLiquidityAdded') ?? 0n,
    totalLiquidityRemoved: pick(raw, 4, 'totalLiquidityRemoved') ?? 0n,
    numMarkets: Number(pick(raw, 5, 'numMarkets') || 0),
    numSettledMarkets: Number(pick(raw, 6, 'numSettledMarkets') || 0),
    allMarketsSettled: Boolean(pick(raw, 7, 'allMarketsSettled')),
    withdrawalsEnabled: Boolean(pick(raw, 8, 'withdrawalsEnabled')),
    initialized: Boolean(pick(raw, 9, 'initialized')),
    lpSharesAtClose: pick(raw, 10, 'lpSharesAtClose') ?? 0n,
    maxExposureMultiplierBps: pick(raw, 11, 'maxExposureMultiplierBps') ?? 0n,
    totalLockedPayouts: pick(raw, 12, 'totalLockedPayouts') ?? 0n,
    winningSportCategory: Number(pick(raw, 13, 'winningSportCategory') || 0),
  }
}

function epochForGroup(group, currentEpoch) {
  const market = group.markets?.[0]
  const epochId = market?.raw?.epochId ?? market?.epochId ?? currentEpoch
  return Number(epochId || 0)
}

function getPhase(epochState, now) {
  if (!epochState?.initialized) {
    return 'uninitialized'
  }
  if (epochState.withdrawalsEnabled) {
    return 'withdrawals_open'
  }
  if (now < epochState.startTime) {
    return 'deposit_open'
  }
  if (now >= epochState.startTime && now < epochState.endTime) {
    return 'betting_open'
  }
  return 'settlement_pending'
}

function phaseLabel(phase) {
  switch (phase) {
    case 'deposit_open': return 'Deposit open'
    case 'betting_open': return 'Betting open'
    case 'settlement_pending': return 'Settlement pending'
    case 'withdrawals_open': return 'Withdrawals open'
    default: return 'Not initialized'
  }
}

function phaseTone(phase) {
  switch (phase) {
    case 'deposit_open': return 'bg-emerald-100 text-emerald-700 border-emerald-200'
    case 'betting_open': return 'bg-sky-100 text-sky-700 border-sky-200'
    case 'settlement_pending': return 'bg-amber-100 text-amber-700 border-amber-200'
    case 'withdrawals_open': return 'bg-violet-100 text-violet-700 border-violet-200'
    default: return 'bg-slate-100 text-slate-600 border-slate-200'
  }
}

export default function LiquidityProvider() {
  const {
    groups,
    currentEpoch,
    lpStats,
    mockTokenSymbol,
    mockTokenBalanceFormatted,
    mockTokenLoading,
    reloadMockTokenBalance,
    reloadBalance,
    ethersProvider,
    walletAddress,
    refetch,
  } = useContractDashboard()

  const [epochState, setEpochState] = useState(null)
  const [epochLoading, setEpochLoading] = useState(false)
  const [signer, setSigner] = useState(null)
  const [depositAmount, setDepositAmount] = useState('100')
  const [withdrawShares, setWithdrawShares] = useState('')
  const [withdrawStatus, setWithdrawStatus] = useState('')
  const [depositStatus, setDepositStatus] = useState('')
  const [actionError, setActionError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const provider = useMemo(() => ethersProvider || getReadProvider(), [ethersProvider])
  const coreRead = useMemo(() => getCoreContract(provider), [provider])
  const vaultRead = useMemo(() => getLiquidityVaultContract(provider), [provider])

  const epochGroups = useMemo(() => {
    return (groups || []).filter((group) => epochForGroup(group, currentEpoch) === Number(currentEpoch || 0))
  }, [groups, currentEpoch])

  const stats = lpStats || {}
  const now = Math.floor(Date.now() / 1000)
  const phase = getPhase(epochState, now)
  const canDeposit = phase === 'deposit_open'
  const canRequestWithdraw = phase === 'withdrawals_open'
  const canProcessWithdraw = Boolean(lpStats?.withdrawalPending && Number(lpStats?.withdrawalAvailableAt || 0) > 0 && Number(lpStats.withdrawalAvailableAt) <= now)

  useEffect(() => {
    let cancelled = false
    const loadSigner = async () => {
      if (!ethersProvider?.getSigner) {
        setSigner(null)
        return
      }
      try {
        const nextSigner = await ethersProvider.getSigner()
        if (!cancelled) setSigner(nextSigner)
      } catch {
        if (!cancelled) setSigner(null)
      }
    }
    loadSigner()
    return () => {
      cancelled = true
    }
  }, [ethersProvider])

  useEffect(() => {
    let cancelled = false
    const loadEpoch = async () => {
      if (!coreRead || !currentEpoch) {
        setEpochState(null)
        return
      }
      setEpochLoading(true)
      try {
        const raw = await coreRead.epochs(BigInt(currentEpoch))
        if (!cancelled) setEpochState(parseEpoch(raw))
      } catch (error) {
        if (!cancelled) setEpochState(null)
      } finally {
        if (!cancelled) setEpochLoading(false)
      }
    }
    loadEpoch()
    return () => {
      cancelled = true
    }
  }, [coreRead, currentEpoch])

  const timeline = useMemo(() => {
    if (!epochState?.initialized) {
      return [
        { key: 'deposit', label: 'Deposit', status: 'Waiting for epoch init' },
        { key: 'betting', label: 'Betting', status: 'Waiting for epoch init' },
        { key: 'withdraw', label: 'Withdraw', status: 'Waiting for epoch init' },
      ]
    }

    return [
      {
        key: 'deposit',
        label: 'Deposit window',
        status: now < epochState.startTime ? 'Open' : 'Closed',
        active: now < epochState.startTime,
        time: `Until ${formatDateTime(epochState.startTime)}`,
      },
      {
        key: 'betting',
        label: 'Betting window',
        status: now >= epochState.startTime && now < epochState.endTime ? 'Open' : now < epochState.startTime ? 'Upcoming' : 'Closed',
        active: now >= epochState.startTime && now < epochState.endTime,
        time: `${formatDateTime(epochState.startTime)} ? ${formatDateTime(epochState.endTime)}`,
      },
      {
        key: 'withdraw',
        label: 'Withdrawal window',
        status: epochState.withdrawalsEnabled ? 'Open' : 'Closed',
        active: epochState.withdrawalsEnabled,
        time: epochState.withdrawalsEnabled ? 'After settlement' : 'After settle + epoch advance',
      },
    ]
  }, [epochState, now])

  const vaultWrite = useMemo(() => {
    if (!signer || !CONTRACT_ADDRESSES.liquidityVault) return null
    return new Contract(CONTRACT_ADDRESSES.liquidityVault, VAULT_WRITE_ABI, signer)
  }, [signer])

  const tokenWrite = useMemo(() => {
    if (!signer || !CONTRACT_ADDRESSES.core) return null
    if (!CONTRACT_ADDRESSES.liquidityVault) return null
    const tokenAddress = CONTRACT_ADDRESSES.mockToken || null
    if (!tokenAddress && !walletAddress) return null
    return tokenAddress ? new Contract(tokenAddress, ERC20_WRITE_ABI, signer) : null
  }, [signer, walletAddress])

  async function refreshAll() {
    await Promise.allSettled([
      refetch?.(),
      reloadMockTokenBalance?.(),
      reloadBalance?.(),
    ])
  }

  async function handleDeposit(event) {
    event.preventDefault()
    setActionError('')
    setDepositStatus('')
    if (!vaultWrite || !signer || !tokenWrite) {
      setActionError('Connect your wallet first.')
      return
    }

    const amountText = String(depositAmount || '').trim()
    if (!amountText || Number(amountText) <= 0) {
      setActionError('Enter a valid deposit amount.')
      return
    }

    try {
      setSubmitting(true)
      const amount = parseUnits(amountText, 6)
      const signerAddress = await signer.getAddress()
      const allowance = await tokenWrite.allowance(signerAddress, CONTRACT_ADDRESSES.liquidityVault)
      if (allowance < amount) {
        const approveTx = await tokenWrite.approve(CONTRACT_ADDRESSES.liquidityVault, amount)
        await approveTx.wait()
      }

      const tx = await vaultWrite.addLiquidity(amount)
      await tx.wait()
      setDepositStatus(`Deposited ${amountText} ${mockTokenSymbol} into epoch ${currentEpoch}.`)
      await refreshAll()
    } catch (error) {
      setActionError(error?.shortMessage || error?.message || 'Deposit failed.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRequestWithdraw(event) {
    event.preventDefault()
    setActionError('')
    setWithdrawStatus('')
    if (!vaultWrite || !signer) {
      setActionError('Connect your wallet first.')
      return
    }

    const sharesText = String(withdrawShares || '').trim()
    if (!sharesText || Number(sharesText) <= 0) {
      setActionError('Enter a valid share amount.')
      return
    }

    try {
      setSubmitting(true)
      const shares = BigInt(sharesText)
      const tx = await vaultWrite.requestWithdraw(shares)
      await tx.wait()
      setWithdrawStatus(`Withdrawal requested for ${sharesText} shares.`)
      await refreshAll()
    } catch (error) {
      setActionError(error?.shortMessage || error?.message || 'Withdrawal request failed.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleProcessWithdraw() {
    setActionError('')
    setWithdrawStatus('')
    if (!vaultWrite || !signer) {
      setActionError('Connect your wallet first.')
      return
    }

    try {
      setSubmitting(true)
      const tx = await vaultWrite.processWithdrawal()
      await tx.wait()
      setWithdrawStatus('Withdrawal processed.')
      await refreshAll()
    } catch (error) {
      setActionError(error?.shortMessage || error?.message || 'Withdrawal processing failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-canvas font-inter">
      <TopNav activeNav="LP" setActiveNav={() => {}} />

      <main className="max-w-7xl mx-auto px-4 lg:px-6 py-6 space-y-6">
        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-light-pearl bg-white p-4">
            <div className="text-[12px] text-silver-ash">Current Epoch</div>
            <div className="text-[24px] font-bold text-midnight">{currentEpoch || '—'}</div>
            <div className={`mt-2 inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${phaseTone(phase)}`}>
              {epochLoading ? 'Loading epoch status…' : phaseLabel(phase)}
            </div>
          </div>
          <div className="rounded-xl border border-light-pearl bg-white p-4">
            <div className="text-[12px] text-silver-ash">Wallet Balance</div>
            <div className="text-[24px] font-bold text-midnight">{mockTokenLoading ? 'Loading…' : `${mockTokenBalanceFormatted} ${mockTokenSymbol}`}</div>
          </div>
          <div className="rounded-xl border border-light-pearl bg-white p-4">
            <div className="text-[12px] text-silver-ash">LP Shares</div>
            <div className="text-[24px] font-bold text-midnight">{stats.shares ? Number(stats.shares).toLocaleString() : '—'}</div>
          </div>
          <div className="rounded-xl border border-light-pearl bg-white p-4">
            <div className="text-[12px] text-silver-ash">NAV</div>
            <div className="text-[24px] font-bold text-midnight">{stats.nav ? (Number(stats.nav) / 1_000_000).toFixed(4) : '—'}</div>
          </div>
        </section>

        <section className="rounded-2xl border border-light-pearl bg-white p-4">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <div className="text-[15px] font-semibold text-midnight">Epoch timeline</div>
              <div className="text-[12px] text-silver-ash">Deposit closes at kickoff, betting runs during the match window, withdrawals open after settlement.</div>
            </div>
            <button onClick={() => reloadMockTokenBalance?.()} className="text-[12px] text-midnight underline">
              Refresh balance
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {timeline.map((item) => (
              <div key={item.key} className={`rounded-xl border p-4 ${item.active ? 'border-sunset-orange bg-cloud-whisper' : 'border-light-pearl bg-white'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[13px] font-semibold text-midnight">{item.label}</div>
                  <div className="text-[11px] font-semibold text-silver-ash">{item.status}</div>
                </div>
                <div className="mt-2 text-[12px] text-silver-ash">{item.time}</div>
                <div className={`mt-3 h-1.5 rounded-full ${item.active ? 'bg-sunset-orange' : 'bg-light-pearl'}`} />
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-2xl border border-light-pearl bg-white overflow-hidden">
            <div className="border-b border-light-pearl px-4 py-3">
              <div className="text-[15px] font-semibold text-midnight">Epoch-driven market book</div>
              <div className="text-[12px] text-silver-ash">All current markets grouped by the active epoch.</div>
            </div>

            <div className="divide-y divide-light-pearl">
              {epochGroups.length === 0 ? (
                <div className="px-4 py-8 text-sm text-silver-ash">No markets loaded for the current epoch yet.</div>
              ) : epochGroups.map((group) => (
                <div key={group.groupId} className="px-4 py-4 space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="text-[14px] font-semibold text-midnight">{group.title || `Group #${group.groupId}`}</div>
                      <div className="text-[12px] text-silver-ash">Group #{group.groupId} · {group.markets?.length || 0} markets · {group.resultFinalized ? `Final ${group.homeScore}-${group.awayScore}` : 'Live book'}</div>
                    </div>
                    <div className="text-right text-[12px] text-silver-ash">
                      <div>{group.eventStartTime ? new Date(group.eventStartTime * 1000).toLocaleString() : 'No start time'}</div>
                      <div>{group.currentExposure ? 'Exposure live' : 'Exposure open'}</div>
                    </div>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-3">
                    {(group.markets || []).map((market) => (
                      <div key={market.marketId} className="rounded-xl border border-light-pearl bg-cloud-whisper p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-[13px] font-semibold text-midnight">{market.title || market.marketName}</div>
                            <div className="text-[11px] text-silver-ash">{market.status} · {market.marketName}</div>
                          </div>
                          <div className="text-[11px] text-silver-ash">ID {market.marketId}</div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {(market.currentOdds || []).map((odd, index) => (
                            <div key={index} className="min-w-[72px] rounded-lg bg-white border border-light-pearl px-2 py-2 text-center">
                              <div className="text-[10px] text-silver-ash">O{index + 1}</div>
                              <div className="text-[13px] font-semibold text-midnight">{formatOdds(odd)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <section className="rounded-2xl border border-light-pearl bg-white p-4 space-y-3">
              <div>
                <div className="text-[15px] font-semibold text-midnight">Deposit to epoch</div>
                <div className="text-[12px] text-silver-ash">Deposit window is only open before kickoff.</div>
              </div>
              <form onSubmit={handleDeposit} className="space-y-3">
                <div>
                  <label className="block text-[12px] text-silver-ash mb-1">Amount ({mockTokenSymbol})</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    disabled={!canDeposit || submitting}
                    className="w-full rounded-lg border border-light-pearl bg-canvas px-3 py-2 text-sm text-midnight disabled:opacity-60"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!canDeposit || submitting}
                  className="w-full rounded-lg bg-sunset-orange px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {submitting ? 'Submitting…' : canDeposit ? 'Deposit into current epoch' : 'Deposits closed for this epoch'}
                </button>
              </form>
              {depositStatus ? <div className="text-[12px] text-emerald-700">{depositStatus}</div> : null}
            </section>

            <section className="rounded-2xl border border-light-pearl bg-white p-4 space-y-3">
              <div>
                <div className="text-[15px] font-semibold text-midnight">Withdraw from epoch</div>
                <div className="text-[12px] text-silver-ash">Withdrawal opens after the epoch is settled and advanced.</div>
              </div>
              <form onSubmit={handleRequestWithdraw} className="space-y-3">
                <div>
                  <label className="block text-[12px] text-silver-ash mb-1">Shares to redeem</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={withdrawShares}
                    onChange={(e) => setWithdrawShares(e.target.value)}
                    disabled={!canRequestWithdraw || submitting}
                    className="w-full rounded-lg border border-light-pearl bg-canvas px-3 py-2 text-sm text-midnight disabled:opacity-60"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!canRequestWithdraw || submitting}
                  className="w-full rounded-lg bg-midnight px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {canRequestWithdraw ? 'Request withdrawal' : 'Withdrawals not open yet'}
                </button>
              </form>

              <button
                type="button"
                onClick={handleProcessWithdraw}
                disabled={!canProcessWithdraw || submitting}
                className="w-full rounded-lg border border-light-pearl px-4 py-2.5 text-sm font-semibold text-midnight disabled:opacity-60"
              >
                {canProcessWithdraw ? 'Process pending withdrawal' : 'Waiting for cooldown'}
              </button>

              <div className="grid grid-cols-2 gap-3 text-[12px] text-silver-ash">
                <div className="rounded-lg bg-cloud-whisper p-3">
                  <div className="mb-1">Pending shares</div>
                  <div className="font-semibold text-midnight">{stats.pendingWithdrawalShares ? Number(stats.pendingWithdrawalShares).toLocaleString() : '0'}</div>
                </div>
                <div className="rounded-lg bg-cloud-whisper p-3">
                  <div className="mb-1">Withdraw at</div>
                  <div className="font-semibold text-midnight">{stats.withdrawalAvailableAt ? formatDateTime(stats.withdrawalAvailableAt) : '—'}</div>
                </div>
              </div>

              {withdrawStatus ? <div className="text-[12px] text-emerald-700">{withdrawStatus}</div> : null}
            </section>

            <section className="rounded-2xl border border-light-pearl bg-white p-4 text-[12px] text-silver-ash space-y-2">
              <div>LP stats are read from the contract snapshot.</div>
              <div>Use the faucet to top up mock token balance, then deposit and test epoch lifecycle flows.</div>
              {actionError ? <div className="text-red-600">{actionError}</div> : null}
            </section>
          </div>
        </section>
      </main>
    </div>
  )
}


