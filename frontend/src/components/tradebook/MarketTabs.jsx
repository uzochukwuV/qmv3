import React from "react";
import { marketTabs } from "@/lib/sportsData";

export default function MarketTabs({ activeMarket, setActiveMarket }) {
  return (
    <div className="flex gap-2 overflow-x-auto hide-scrollbar pb-1 mb-4">
      {marketTabs.map((tab) => (
        <button
          key={tab}
          onClick={() => setActiveMarket(tab)}
          className={`shrink-0 px-4 py-[6px] rounded-[20px] font-inter text-[13px] font-medium transition-all border ${
            activeMarket === tab
              ? "bg-midnight text-white border-midnight"
              : "bg-cloud-whisper text-dark-shale border-light-pearl hover:border-silver-ash"
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}