import { useEffect, useRef, useState } from "react";

export default function ForYou() {
  const [videos, setVideos] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [topTab, setTopTab] = useState("foryou");
  const containerRef = useRef<HTMLDivElement>(null);

  // Load 1332 videos + random injection 0.15
  useEffect(() => {
    try {
      const stored = localStorage.getItem("videos") || localStorage.getItem("allVideos") || "[]";
      let all = JSON.parse(stored);
      if (all.length === 0) {
        // fallback if no videos yet
        all = Array.from({ length: 20 }, (_, i) => ({
          id: i,
          url: "",
          username: "drewmclawhorn3",
          caption: "Loop video #" + i,
          likes: Math.floor(Math.random()*100),
          comments: 0,
          shares: 0,
        }));
      }
      // Random injection like TikTok For You
      const shuffled = [...all];
      for (let i = shuffled.length - 1; i > 0; i--) {
        if (Math.random() < 0.15) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
      }
      setVideos(shuffled);
    } catch {
      setVideos([]);
    }
  }, []);

  // Save to history + offline every time you swipe
  useEffect(() => {
    if (!videos[currentIndex]) return;
    try {
      const history = JSON.parse(localStorage.getItem("history:videos") || "[]");
      history.unshift({ ...videos[currentIndex], watchedAt: new Date().toISOString() });
      localStorage.setItem("history:videos", JSON.stringify(history.slice(0,200)));
      
      const cached = JSON.parse(localStorage.getItem("offline:cachedVideos") || "[]");
      if (!cached.find((v:any) => v.id === videos[currentIndex].id)) {
        cached.push(videos[currentIndex]);
        localStorage.setItem("offline:cachedVideos", JSON.stringify(cached.slice(-100)));
      }
    } catch {}
  }, [currentIndex, videos]);

  // Swipe up/down to change video like TikTok
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let startY = 0;
    const onStart = (e: TouchEvent) => { startY = e.touches[0].clientY; };
    const onEnd = (e: TouchEvent) => {
      const diff = e.changedTouches[0].clientY - startY;
      if (Math.abs(diff) > 60) {
        if (diff < 0 && currentIndex < videos.length - 1) setCurrentIndex(i => i + 1);
        if (diff > 0 && currentIndex > 0) setCurrentIndex(i => i - 1);
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > 30) {
        if (e.deltaY > 0 && currentIndex < videos.length - 1) setCurrentIndex(i => i + 1);
        if (e.deltaY < 0 && currentIndex > 0) setCurrentIndex(i => i - 1);
      }
    };
    el.addEventListener("touchstart", onStart);
    el.addEventListener("touchend", onEnd);
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("wheel", onWheel);
    };
  }, [currentIndex, videos.length]);

  const currentVideo = videos[currentIndex];

  return (
    <div className="relative h- w-screen overflow-hidden bg-black">
      <style>{`
        .tiktok-video {
          position: absolute;
          inset: 0;
          width: 100vw;
          height: 100dvh;
          object-fit: cover;
          background: black;
        }
        .feed-wrap {
          height: 100dvh;
          width: 100vw;
        }
      `}</style>

      {/* TOP TABS - exactly like your 2nd pic: LIVE STEM Community Following For You */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-3 pt-12 pb-2 bg-gradient-to-b from-black/60 to-transparent">
        <div className="flex items-center gap-4 text- font-bold overflow-x-auto whitespace-nowrap scrollbar-none">
          <button onClick={() => window.location.href="/live"} className="flex items-center gap-1 text-white/70">
            <span className="border border-white/70 rounded px-1 text-">LIVE</span>
          </button>
          <button onClick={() => setTopTab("stem")} className={topTab==="stem" ? "text-white" : "text-white/60"}>STEM</button>
          <button onClick={() => setTopTab("community")} className={topTab==="community" ? "text-white" : "text-white/60"}>Community</button>
          <button onClick={() => setTopTab("following")} className={topTab==="following" ? "text-white" : "text-white/60"}>Following</button>
          <button onClick={() => setTopTab("foryou")} className={topTab==="foryou" ? "text-white" : "text-white/60"}>
            For You
            {topTab==="foryou" && <div className="mx-auto mt-1 h- w-6 bg-white rounded-full" />}
          </button>
        </div>
        <button onClick={() => window.location.href="/search"} className="text-white ml-2"[STRIPPED 23 bytes]"24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-3.5-3.5"/></svg>
        </button>
      </div>

      {/* FULL SCREEN VIDEO - FILLS LIKE TIKTOK */}
      <div ref={containerRef} className="feed-wrap relative">
        {currentVideo ? (
          <>
            {currentVideo.url ? (
              <video
                key={currentVideo.id || currentIndex}
                src={currentVideo.url}
                className="tiktok-video"
                autoPlay
                loop
                muted={isMuted}
                playsInline
                controls={false}
              />
            ) : (
              <div className="tiktok-video flex items-center justify-center bg-zinc-900 text-white">
                <p>No video file — placeholder for {currentVideo.username}</p>
              </div>
            )}

            {/* BOTTOM LEFT - @drewmclawhorn3 style */}
            <div className="absolute bottom- left-0 right- z-20 px-3">
              <p className="text-white font-bold text-">@{currentVideo.username || "drewmclawhorn3"}</p>
              <p className="text-white text- mt-1 line-clamp-2">{currentVideo.caption || "TTK: ERASAGI 🔥"}</p>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-white/80 text-xs">♫ Original sound - {currentVideo.username}</span>
              </div>
            </div>

            {/* RIGHT BAR - D, heart 6, comment 0, share 0 like your 1st pic */}
            <div className="absolute right-2 bottom- z-20 flex flex-col items-center gap-5">
              <button onClick={() => setIsMuted(!isMuted)} className="h-9 w-9 rounded-full bg-white/20 backdrop-blur flex items-center justify-center text-white text-xs">
                {isMuted ? "🔇" : "🔊"}
              </button>

              <button className="flex flex-col items-center">
                <div className="h- w- rounded-full bg-[#ff2d55] flex items-center justify-center text-white font-bold">D</div>
              </button>

              <button className="flex flex-col items-center">
                <div className="h- w- rounded-full bg-white/20 backdrop-blur flex items-center justify-center">
                  <span className="text-white text-2xl">❤</span>
                </div>
                <span className="text-white text-xs font-bold mt-1">{currentVideo.likes || 6}</span>
              </button>

              <button className="flex flex-col items-center">
                <div className="h- w- rounded-full bg-white/20 backdrop-blur flex items-center justify-center"[STRIPPED 31 bytes]"24" height="24" fill="white" viewBox="0 0 24 24"><path d="M21 11.5a8.5 8.5 0 0 1-12.5 7.5L2 22l3-6.5A8.5 8.5 0 0 1 21 11.5z" stroke="white" strokeWidth="1.5" fill="none"/></svg>
                </div>
                <span className="text-white text-xs font-bold mt-1">{currentVideo.comments || 0}</span>
              </button>

              <button className="flex flex-col items-center">
                <div className="h- w- rounded-full bg-white/20 backdrop-blur flex items-center justify-center"[STRIPPED 31 bytes]"24" height="24" fill="white" viewBox="0 0 24 24"><path d="M18 13v-2a6 6 0 0 0-6-6H8M8 11H6a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2M16 17h2a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-2M12 8l-4 4 4M16 12H8" stroke="white" strokeWidth="1.8" fill="none"/></svg>
                </div>
                <span className="text-white text-xs font-bold mt-1">{currentVideo.shares || 0}</span>
              </button>

              <button className="mt-2">
                <div className="h- w- rounded-full bg-gradient-to-b from-zinc-700 to-zinc-900 border-2 border-white/20 overflow-hidden flex items-center justify-center">
                  <span className="text-xs">♪</span>
                </div>
              </button>
            </div>

            {/* Progress bar pink like 1st pic */}
            <div className="absolute bottom- left-0 right-0 h- bg-white/20 z-20">
              <div className="h-full bg-white transition-all" style={{ width: `${((currentIndex+1)/Math.max(videos.length,1))*100}%` }} />
            </div>
          </>
        ) : (
          <div className="tiktok-video flex items-center justify-center text-white">Loading 1332 videos...</div>
        )}
      </div>

      {/* BOTTOM NAV - Home Friends + Inbox Profile like 2nd pic */}
      <div className="fixed bottom-0 left-0 right-0 h- bg-black border-t border-white/10 flex justify-around items-center z-30 pb-1">
        <button className="flex flex-col items-center text-white"><div className="text-xl">⌂</div><span className="text- mt-0.5">Home</span></button>
        <button onClick={() => setTopTab("friends")} className="flex flex-col items-center text-white/60"><div className="text-xl">👥</div><span className="text- mt-0.5">Friends</span></button>
        <button onClick={() => window.location.href="/live"} className="flex flex-col items-center">
          <div className="h-9 w- rounded- bg-white flex items-center justify-center border-2 border-white relative">
            <div className="absolute -left-1 top-0 bottom-0 w-2 bg-cyan-400 rounded-l- -z-10" />
            <div className="absolute -right-1 top-0 bottom-0 w-2 bg-[#ff2d55] rounded-r- -z-10" />
            <span className="text-black text-2xl font-bold">+</span>
          </div>
        </button>
        <button onClick={() => window.location.href="/inbox"} className="flex flex-col items-center text-white/60"><div className="text-xl">💬</div><span className="text- mt-0.5">Inbox</span></button>
        <button onClick={() => window.location.href="/profile"} className="flex flex-col items-center text-white/60"><div className="text-xl">👤</div><span className="text- mt-0.5">Profile</span></button>
      </div>
    </div>
  );
}
