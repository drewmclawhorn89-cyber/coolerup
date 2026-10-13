import { useState } from "react"

const tabs = ["STEM", "Community", "Following", "For You"]

export function TopTabs() {
  const [active, setActive] = useState("For You")

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-black border-b border-white/10">
      <div className="flex items-center gap-6 overflow-x-auto px-4 py-3 scrollbar-hide">
        <div className="flex items-center gap-1 text-white font-bold mr-2">
          <span className="border-2 border-white px-1">LIVE</span>
        </div>
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActive(tab)}
            className={`whitespace-nowrap text-[16px] font-semibold transition-colors relative pb-1
              ${active === tab ? "text-white" : "text-white/50"}`}
          >
            {tab}
            {active === tab && (
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-6 h-[3px] bg-white rounded-full" />
            )}
          </button>
        ))}
        <button className="ml-auto"[STRIPPED 23 bytes]"24" height="24" fill="white" viewBox="0 0 24 24"><path d="M10 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm0-2a6 6 0 1 0 0-12 6 6 0 0 0 0 12zm8 2l-4.5-4.5" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
      </div>
    </div>
  )
}
