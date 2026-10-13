export function TopTabs() {
  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-black/90 backdrop-blur border-b border-white/10">
      <div className="flex items-center gap-6 overflow-x-auto px-4 py-3 no-scrollbar">
        <span className="text-white font-black text-sm border-2 border-white px-1.5 py-0.5">LIVE</span>
        <button className="whitespace-nowrap text-white/50 font-semibold">STEM</button>
        <button className="whitespace-nowrap text-white/50 font-semibold">Community</button>
        <button className="whitespace-nowrap text-white/50 font-semibold">Following</button>
        <button className="whitespace-nowrap text-white font-bold relative">For You
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-6 h-[3px] bg-white rounded-full" />
        </button>
      </div>
    </div>
  )
}.
