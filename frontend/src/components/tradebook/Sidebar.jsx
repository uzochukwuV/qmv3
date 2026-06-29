import React from "react";
import { sportsCategories, popularLeagues } from "@/lib/sportsData";

export default function Sidebar({ activeSport, setActiveSport }) {
  return (
    <aside className="w-[220px] bg-canvas border-r border-light-pearl shrink-0 overflow-y-auto h-full hidden lg:block">
      <div className="py-4">
        <h3 className="font-inter text-[11px] font-semibold text-silver-ash uppercase tracking-wider px-5 mb-2">
          Sports
        </h3>
        {sportsCategories.map((sport) => {
          const isActive = activeSport === sport.name;
          return (
            <button
              key={sport.name}
              onClick={() => setActiveSport(sport.name)}
              className={`w-full flex items-center gap-3 px-5 py-[10px] font-inter text-[14px] transition-all text-left ${
                isActive
                  ? "border-l-[3px] border-l-sunset-orange bg-slate-mist text-midnight font-medium"
                  : "border-l-[3px] border-l-transparent text-midnight hover:bg-cloud-whisper"
              }`}
            >
              <span className="text-base">{sport.icon}</span>
              <span className="flex-1">{sport.name}</span>
              <span className="font-inter text-[12px] text-silver-ash">({sport.count})</span>
            </button>
          );
        })}
      </div>

      <div className="border-t border-light-pearl py-4">
        <h3 className="font-inter text-[11px] font-semibold text-silver-ash uppercase tracking-wider px-5 mb-2">
          Popular Leagues
        </h3>
        {popularLeagues.map((league) => (
          <button
            key={league.name}
            className="w-full flex items-center gap-3 px-5 py-[9px] font-inter text-[13px] text-dark-shale hover:bg-cloud-whisper hover:text-midnight transition-colors text-left"
          >
            <span className="text-base">{league.flag}</span>
            <span>{league.name}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}