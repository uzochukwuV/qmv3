import React, { useState, useMemo } from "react";
import { X, Trash2, Receipt } from "lucide-react";
import { betHistory } from "@/lib/sportsData";

const QUICK_STAKES = [500, 1000, 2000, 5000];

const statusColors = {
  won: "bg-green-500",
  lost: "bg-red-500",
  pending: "bg-sunset-orange",
};

const statusLabels = {
  won: "Won",
  lost: "Lost",
  pending: "Pending",
};

export default function BetSlip({ bets, onRemoveBet, onClearSlip }) {
  const [stake, setStake] = useState(1000);
  const [activeTab, setActiveTab] = useState("slip");

  const totalOdds = useMemo(() => {
    if (bets.length === 0) return 1;
    return bets.reduce((acc, bet) => acc * bet.odds, 1);
  }, [bets]);

  const potentialWin = totalOdds * stake;

  const formatCurrency = (num) =>
    num.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const handleStakeInput = (e) => {
    const raw = e.target.value.replace(/[^0-9]/g, "");
    setStake(raw === "" ? 0 : parseInt(raw, 10));
  };

  return (
    <aside className="w-[280px] bg-canvas border-l border-light-pearl shrink-0 flex flex-col sticky top-0 h-[calc(100vh-100px)] overflow-hidden">
      {/* Header */}
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

        {/* Tabs */}
        <div className="flex border-b border-light-pearl">
          {["slip", "history"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 font-inter text-[13px] font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? "border-midnight text-midnight"
                  : "border-transparent text-silver-ash hover:text-dark-shale"
              }`}
            >
              {tab === "slip" ? "Selections" : (
                <>
                  <Receipt className="w-3.5 h-3.5" />
                  History
                </>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Slip Tab */}
      {activeTab === "slip" && (
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Selections list */}
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

          {/* Stake & Payout — always visible at bottom */}
          <div className="shrink-0 border-t border-light-pearl px-4 pt-3 pb-4 space-y-3 bg-canvas">
            {/* Stake input */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="font-inter text-[12px] font-semibold text-dark-shale uppercase tracking-wide">Stake</label>
                <span className="font-inter text-[12px] text-silver-ash">₦</span>
              </div>
              <input
                type="text"
                value={stake === 0 ? "" : stake.toLocaleString("en-NG")}
                onChange={handleStakeInput}
                placeholder="Enter amount"
                className="w-full border border-midnight/20 rounded-lg px-3 py-2 font-inter text-[15px] font-semibold text-midnight focus:outline-none focus:border-sunset-orange transition-colors bg-canvas text-right"
              />
            </div>

            {/* Quick stake buttons */}
            <div className="grid grid-cols-4 gap-1.5">
              {QUICK_STAKES.map((amount) => (
                <button
                  key={amount}
                  onClick={() => setStake(amount)}
                  className={`py-1 rounded font-inter text-[11px] font-medium border transition-all ${
                    stake === amount
                      ? "bg-midnight text-white border-midnight"
                      : "bg-cloud-whisper text-dark-shale border-light-pearl hover:border-silver-ash"
                  }`}
                >
                  {amount >= 1000 ? `${amount / 1000}K` : amount}
                </button>
              ))}
            </div>

            {/* Summary rows */}
            <div className="space-y-1.5 bg-cloud-whisper rounded-lg px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="font-inter text-[12px] text-silver-ash">{bets.length} Selection{bets.length !== 1 ? "s" : ""}</span>
                <span className="font-inter text-[12px] font-medium text-dark-shale">Accumulator</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-inter text-[12px] text-silver-ash">Total Odds</span>
                <span className="font-inter text-[13px] font-bold text-midnight">{bets.length > 0 ? totalOdds.toFixed(2) : "—"}</span>
              </div>
              <div className="h-px bg-light-pearl my-1" />
              <div className="flex items-center justify-between">
                <span className="font-inter text-[13px] font-semibold text-dark-shale">Potential Win</span>
                <span className="font-inter text-[15px] font-bold text-midnight">
                  {bets.length > 0 ? `₦ ${formatCurrency(potentialWin)}` : "—"}
                </span>
              </div>
            </div>

            <button
              disabled={bets.length === 0 || stake === 0}
              className="w-full bg-sunset-orange text-white font-inter text-[14px] font-bold py-3 rounded-[20px] hover:bg-sunset-orange/90 transition-colors active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed tracking-wide"
            >
              PLACE BET — ₦ {stake > 0 ? formatCurrency(stake) : "0.00"}
            </button>
          </div>
        </div>
      )}

      {/* History Tab */}
      {activeTab === "history" && (
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {betHistory.map((item) => (
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
          ))}
        </div>
      )}
    </aside>
  );
}