import React, { useEffect, useMemo, useState } from 'react'
import { X, Trash2, Receipt } from 'lucide-react'
import { getBetSlipsContract, getReadProvider } from '@/lib/contracts'

const QUICK_STAKES = [10, 25, 50, 100]
const TOKEN_DECIMALS = 6
const BPS = 10_000n
const ODDS_PRECISION = 1_000_000n
const MAX_LEGS = 8

const statusColors = {
  won: 'bg-green-500',
  lost: 'bg-red-500',
  pending: 'bg-sunset-orange',
}

const statusLabels = {
  won: 'Won',
  lost: 'Lost',
  pending: 'Pending',
}

function parseAmount(value) {
  const numeric = Number(String(value ?? '0').replace(/,/g, ''))
  return Number.isFinite(numeric) ? numeric : 0
}

function toBaseUnits(amount) {
  const whole = Math.max(0, Math.floor(Number(amount || 0)))
  return BigInt(whole) * 10n ** BigInt(TOKEN_DECIMALS)
}

function formatBaseUnits(value) {
  if (value == null) return '0.00'
  const raw = typeof value === 'bigint' ? value : BigInt(value.toString())
  const divisor = 10n ** BigInt(TOKEN_DECIMALS)
  const whole = raw / divisor
  const fraction = raw % divisor
  const fractionText = fraction.toString().padStart(TOKEN_DECIMALS, '0').slice(0, 2)
  return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fractionText}`
}

function formatOddsValue(value) {
  const raw = typeof value === 'bigint' ? value : BigInt(value?.toString?.() || '0')
  return Number(raw) / Number(ODDS_PRECISION)
}

function deriveBonusAmount(potentialPayout, crossBonusBps) {
  const payout = typeof potentialPayout === 'bigint' ? potentialPayout : BigInt(potentialPayout?.toString?.() || '0')
  const bonusBps = typeof crossBonusBps === 'bigint' ? crossBonusBps : BigInt(crossBonusBps?.toString?.() || '0')
  if (payout === 0n || bonusBps === 0n) return 0n
  const basePayout = (payout * BPS) / (BPS + bonusBps)
  return payout - basePayout
}

function hasUnsupportedMarket(bets) {
  return bets.some((bet) => {
    if (bet.marketStatus == null) return false
    const status = String(bet.marketStatus).toLowerCase()
    return status !== 'open'
  })
}
function buildQuoteParams(bets, stake, currentEpoch = 0) {
  const legs = Array.from({ length: MAX_LEGS }, (_, index) => {
    const bet = bets[index]
    if (!bet) {
      return { marketId: 0n, outcomeId: 0, minOdds: 0n }
    }
    return {
      marketId: BigInt(bet.marketId),
      outcomeId: Number(bet.outcomeIndex ?? 0),
      minOdds: 0n,
    }
  })

  return {
    legs,
    numLegs: bets.length,
    totalStake: toBaseUnits(stake),
    minCombinedOdds: 0n,
  }
}

export default function BetSlip({
  bets = [],
  history = [],
  onRemoveBet,
  onClearSlip,
  tokenBalanceFormatted = '0.00',
  tokenBalanceLoading = false,
  tokenSymbol = 'USDC',
  walletAddress,
  currentEpoch = 0,
}) {
  const [stake, setStake] = useState(10)
  const [activeTab, setActiveTab] = useState('slip')
  const [quote, setQuote] = useState(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState('')

  const readProvider = useMemo(() => getReadProvider(), [])
  const slipsContract = useMemo(() => getBetSlipsContract(readProvider), [readProvider])

  const totalOdds = useMemo(() => {
    if (bets.length === 0) return 1
    return bets.reduce((acc, bet) => acc * bet.odds, 1)
  }, [bets])

  useEffect(() => {
    let cancelled = false

    const loadQuote = async () => {
      if (!slipsContract || bets.length === 0 || stake <= 0) {
        setQuote(null)
        setQuoteError('')
        setQuoteLoading(false)
        return
      }

      const invalidLeg = bets.find((bet) => bet.marketId == null || bet.outcomeIndex == null)
      if (invalidLeg) {
        setQuote(null)
        setQuoteError('Selected slip cannot be quoted yet.')
        setQuoteLoading(false)
        return
      }

      if (hasUnsupportedMarket(bets)) {
        setQuote(null)
        setQuoteError('Quote is only available for open markets.')
        setQuoteLoading(false)
        return
      }

      setQuoteLoading(true)
      setQuoteError('')

      try {
        const params = buildQuoteParams(bets, stake, currentEpoch)
        const result = await slipsContract.quoteSlip(params)
        if (cancelled) return

        setQuote({
          epochId: Number(result.epochId ?? currentEpoch ?? 0),
          numLegs: Number(result.numLegs ?? bets.length),
          totalStake: result.totalStake ?? params.totalStake,
          combinedOdds: result.combinedOdds ?? 0n,
          potentialPayout: result.potentialPayout ?? 0n,
          houseMarginBps: result.houseMarginBps ?? 0n,
          discountBps: result.discountBps ?? 0n,
          crossBonusBps: result.crossBonusBps ?? 0n,
        })
      } catch (error) {
        if (cancelled) return
        setQuote(null)
        setQuoteError(error?.shortMessage || error?.message || 'Unable to quote slip right now.')
      } finally {
        if (!cancelled) setQuoteLoading(false)
      }
    }

    const timer = setTimeout(loadQuote, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [bets, currentEpoch, slipsContract, stake])

  const availableBalance = parseAmount(tokenBalanceFormatted)
  const insufficientBalance = stake > 0 && availableBalance > 0 && stake > availableBalance

  const quotedPayout = quote ? formatBaseUnits(quote.potentialPayout) : '0.00'
  const bonusAmount = quote ? formatBaseUnits(deriveBonusAmount(quote.potentialPayout, quote.crossBonusBps)) : '0.00'
  const combinedOddsDisplay = quote ? formatOddsValue(quote.combinedOdds).toFixed(2) : bets.length > 0 ? totalOdds.toFixed(2) : '—'
  const discountDisplay = quote ? (Number(quote.discountBps || 0) / 100).toFixed(2) : '0.00'
  const bonusBpsDisplay = quote ? (Number(quote.crossBonusBps || 0) / 100).toFixed(2) : '0.00'

  const handleStakeInput = (e) => {
    const raw = e.target.value.replace(/[^0-9]/g, '')
    setStake(raw === '' ? 0 : parseInt(raw, 10))
  }

  return (
    <aside className="w-[280px] bg-canvas border-l border-light-pearl shrink-0 flex flex-col sticky top-0 h-[calc(100vh-100px)] overflow-hidden">
      <div className="px-4 pt-4 pb-0 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="font-inter text-[15px] font-bold text-midnight">Bet Slip</h3>
            {bets.length > 0 && (
              <span className="bg-sunset-orange text-white font-inter text-[11px] font-bold min-w-[20px] h-5 px-1.5 rounded-full flex items-center justify-center">
                {bets.length}
              </span>
            )}
          </div>
          {bets.length > 0 && (
            <button
              onClick={onClearSlip}
              className="flex items-center gap-1 text-silver-ash hover:text-midnight transition-colors"
              title="Clear all"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="font-inter text-[12px]">Clear</span>
            </button>
          )}
        </div>

        <div className="flex border-b border-light-pearl">
          {['slip', 'history'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 font-inter text-[13px] font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? 'border-midnight text-midnight'
                  : 'border-transparent text-silver-ash hover:text-dark-shale'
              }`}
            >
              {tab === 'slip' ? (
                'Selections'
              ) : (
                <>
                  <Receipt className="w-3.5 h-3.5" />
                  History
                </>
              )}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'slip' && (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {bets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <div className="w-12 h-12 rounded-full bg-cloud-whisper flex items-center justify-center">
                  <Receipt className="w-5 h-5 text-silver-ash" />
                </div>
                <p className="font-inter text-[13px] text-silver-ash text-center">
                  Click any odds to<br />add selections
                </p>
              </div>
            ) : (
              bets.map((bet) => (
                <div key={bet.id} className="bg-cloud-whisper rounded-lg p-3 relative group border border-transparent hover:border-light-pearl transition-all">
                  <button
                    onClick={() => onRemoveBet(bet.id)}
                    className="absolute top-2 right-2 text-silver-ash hover:text-midnight opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <div className="font-inter text-[11px] text-silver-ash mb-1 pr-5 truncate">{bet.match}</div>
                  <div className="flex items-center justify-between pr-4">
                    <span className="font-inter text-[13px] font-semibold text-midnight leading-tight">{bet.selection}</span>
                    <span className="font-inter text-[15px] font-bold text-sunset-orange ml-2 shrink-0">{bet.odds.toFixed(2)}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="shrink-0 border-t border-light-pearl px-4 pt-3 pb-4 space-y-3 bg-canvas">
            <div className="rounded-lg border border-light-pearl bg-cloud-whisper px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="font-inter text-[11px] uppercase tracking-wide text-silver-ash">Available balance</span>
                <span className="font-inter text-[12px] font-semibold text-midnight">
                  {tokenBalanceLoading ? 'Loading...' : `${tokenBalanceFormatted} ${tokenSymbol}`}
                </span>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="font-inter text-[12px] font-semibold text-dark-shale uppercase tracking-wide">Stake</label>
                <span className="font-inter text-[12px] text-silver-ash">{tokenSymbol}</span>
              </div>
              <input
                type="text"
                value={stake === 0 ? '' : stake.toLocaleString('en-US')}
                onChange={handleStakeInput}
                placeholder="Enter amount"
                className="w-full border border-midnight/20 rounded-lg px-3 py-2 font-inter text-[15px] font-semibold text-midnight focus:outline-none focus:border-sunset-orange transition-colors bg-canvas text-right"
              />
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {QUICK_STAKES.map((amount) => (
                <button
                  key={amount}
                  onClick={() => setStake(amount)}
                  className={`py-1 rounded font-inter text-[11px] font-medium border transition-all ${
                    stake === amount
                      ? 'bg-midnight text-white border-midnight'
                      : 'bg-cloud-whisper text-dark-shale border-light-pearl hover:border-silver-ash'
                  }`}
                >
                  {amount >= 1000 ? `${amount / 1000}K` : amount}
                </button>
              ))}
            </div>

            <div className="space-y-1.5 bg-cloud-whisper rounded-lg px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="font-inter text-[12px] text-silver-ash">{bets.length} Selection{bets.length !== 1 ? 's' : ''}</span>
                <span className="font-inter text-[12px] font-medium text-dark-shale">Accumulator</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-inter text-[12px] text-silver-ash">Total Odds</span>
                <span className="font-inter text-[13px] font-bold text-midnight">{combinedOddsDisplay}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-inter text-[12px] text-silver-ash">Discount / Bonus</span>
                <span className="font-inter text-[12px] font-bold text-midnight">
                  {quoteLoading ? 'Calculating...' : `${discountDisplay}% / ${bonusBpsDisplay}%`}
                </span>
              </div>
              <div className="h-px bg-light-pearl my-1" />
              <div className="flex items-center justify-between">
                <span className="font-inter text-[13px] font-semibold text-dark-shale">Potential Win</span>
                <span className="font-inter text-[15px] font-bold text-midnight">
                  {bets.length > 0 ? `${tokenSymbol} ${quotedPayout}` : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-inter text-[12px] text-silver-ash">Exact bonus</span>
                <span className="font-inter text-[13px] font-semibold text-midnight">
                  {quote ? `${tokenSymbol} ${bonusAmount}` : '—'}
                </span>
              </div>
            </div>

            {quoteError ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                {quoteError}
              </div>
            ) : null}

            {insufficientBalance ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
                Stake exceeds your {tokenSymbol} balance.
              </div>
            ) : null}

            <button
              disabled={bets.length === 0 || stake === 0 || insufficientBalance || quoteLoading || Boolean(quoteError)}
              className="w-full bg-sunset-orange text-white font-inter text-[14px] font-bold py-3 rounded-[20px] hover:bg-sunset-orange/90 transition-colors active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed tracking-wide"
            >
              PLACE BET — {tokenSymbol} {stake > 0 ? formatBaseUnits(toBaseUnits(stake)) : '0.00'}
            </button>
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {history.length === 0 ? (
            <div className="rounded-lg border border-light-pearl bg-cloud-whisper px-3 py-4 text-[13px] text-silver-ash">
              No on-chain bet history yet.
            </div>
          ) : (
            history.map((item) => (
              <div key={item.id} className="bg-cloud-whisper rounded-lg px-3 py-2.5 flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full shrink-0 ${statusColors[item.status]}`} />
                <div className="flex-1 min-w-0">
                  <div className="font-inter text-[13px] font-medium text-midnight truncate">{item.match}</div>
                  <div className="font-inter text-[11px] text-silver-ash">{statusLabels[item.status]}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-inter text-[13px] font-bold text-midnight">{item.amount}</div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </aside>
  )
}



