import React from "react";

const stats = [
  { icon: "📊", label: "Total Markets Today", value: "4,521" },
  { icon: "🔴", label: "Live Events", value: "12" },
  { icon: "⏰", label: "Starting Soon (1hr)", value: "34" },
  { icon: "💰", label: "Highest Odds Today", value: "245.00" },
];

export default function StatsBar() {
  return (
    <div className="bg-cloud-whisper border-b border-light-pearl px-6 lg:px-10 py-2 flex items-center gap-6 overflow-x-auto hide-scrollbar">
      {stats.map((stat, i) => (
        <React.Fragment key={stat.label}>
          {i > 0 && <span className="text-light-pearl hidden sm:block">|</span>}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-sm">{stat.icon}</span>
            <span className="font-inter text-[13px] text-dark-shale">
              {stat.label}:
            </span>
            <span className="font-inter text-[13px] font-semibold text-midnight">
              {stat.value}
            </span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}