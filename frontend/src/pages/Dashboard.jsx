import React, { useState, useCallback } from "react";
import TopNav from "@/components/tradebook/TopNav";
import StatsBar from "@/components/tradebook/StatsBar";
import Sidebar from "@/components/tradebook/Sidebar";
import LiveMatches from "@/components/tradebook/LiveMatches";
import MarketTabs from "@/components/tradebook/MarketTabs";
import OddsTable from "@/components/tradebook/OddsTable";
import BetSlip from "@/components/tradebook/BetSlip";
import { initialBetSlip } from "@/lib/sportsData";

export default function Dashboard() {
  const [activeNav, setActiveNav] = useState("Pre-Match");
  const [activeSport, setActiveSport] = useState("Football");
  const [activeMarket, setActiveMarket] = useState("All Markets");
  const [betSlip, setBetSlip] = useState(initialBetSlip);

  const selectedOdds = betSlip.map((b) => ({ matchId: b.matchId, market: b.market }));

  const handleOddsClick = useCallback((selection) => {
    setBetSlip((prev) => {
      const exists = prev.find(
        (b) => b.matchId === selection.matchId && b.market === selection.market
      );
      if (exists) {
        return prev.filter((b) => b.id !== exists.id);
      }
      return [
        ...prev,
        {
          id: `bet-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          ...selection,
        },
      ];
    });
  }, []);

  const handleRemoveBet = useCallback((id) => {
    setBetSlip((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const handleClearSlip = useCallback(() => {
    setBetSlip([]);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-canvas overflow-hidden font-inter">
      <TopNav activeNav={activeNav} setActiveNav={setActiveNav} />
      <StatsBar />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeSport={activeSport} setActiveSport={setActiveSport} />

        <main className="flex-1 overflow-y-auto px-4 lg:px-6 py-4">
          <LiveMatches onOddsClick={handleOddsClick} selectedOdds={selectedOdds} />
          <MarketTabs activeMarket={activeMarket} setActiveMarket={setActiveMarket} />
          <OddsTable
            activeMarket={activeMarket}
            onOddsClick={handleOddsClick}
            selectedOdds={selectedOdds}
          />
        </main>

        <BetSlip bets={betSlip} onRemoveBet={handleRemoveBet} onClearSlip={handleClearSlip} />
      </div>
    </div>
  );
}