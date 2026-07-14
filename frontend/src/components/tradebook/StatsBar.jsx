import React from "react";

const defaultStats = [
  { icon: "stats", label: "Total Markets Today", value: "4,521" },
  { icon: "live", label: "Live Events", value: "12" },
  { icon: "soon", label: "Starting Soon (1hr)", value: "34" },
  { icon: "odds", label: "Highest Odds Today", value: "245.00" },
];

export default function StatsBar({ stats = defaultStats }) {
  return (
    <div className="bg-cloud-whisper border-b border-light-pearl px-6 lg:px-10 py-2 flex items-center gap-6 overflow-x-auto hide-scrollbar">
      {stats.map((stat, i) => (
        <React.Fragment key={stat.label}>
          {i > 0 && <span className="text-light-pearl hidden sm:block">|</span>}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-sm">{stat.icon}</span>
            <span className="font-inter text-[13px] text-dark-shale">{stat.label}:</span>
            <span className="font-inter text-[13px] font-semibold text-midnight">{stat.value}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
