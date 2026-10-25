import { useEffect, useState, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { Heart, Share2, MessageCircle } from "lucide-react";

// Replace this with your real fetch - keeping your 1332 videos logic
type Video = { id: string; username: string; caption: string; video_url: string; likes_count: number; comments_count: number; shares_count: number; };

function formatCount(n: number) {
  if (n >= 1000000) return (n/1000000).toFixed(1)+"M";
  if (n >= 1000) return (n/1000).toFixed(1)+"K";
  return n.toString();
}

export default function Index() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  useEffect(() => {
    // YOUR EXISTING LOAD LOGIC - KEEP YOUR 1332 VIDEOS
    const saved = localStorage.getItem("videos");
    if (saved) {
      let v = JSON.parse(saved);
      // your 0.15 random injection
      v = v.sort(() => Math.random() < 0.15 ? 1 : -1);
      setVideos(v);
    }
  }, []);

  // TIKTOK SCROLL - ONLY 1 PLAYS
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const video = entry.target.querySelector("video") as HTMLVideoElement;
        if (!video) return;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.75) {
          video.play().catch(()=>{});
        } else {
          video.pause();
        }
      });
    }, { threshold: 0.75 });

    document.querySelectorAll(".snap-start").forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [videos]);

  if (videos.length === 0) return <div className="bg-black text-white p-4">Loading videos...</div>;

  return (
    <div className="w-full bg-black flex justify-center">
      {/* THIS CONTAINER FIXES FAST SCROLL - SNAP LIKE TIKTOK */}
      <div className="h-[calc(100dvh-88px)] w-full max-w- overflow-y-scroll snap-y snap-mandatory scroll-smooth bg-black [&::-webkit-scrollbar]:hidden">
        {videos.map((video) => (
          <div key={video.id} className="snap-start snap-always h-[calc(100dvh-88px)] w-full relative bg-black flex justify-center overflow-hidden">
            
            {/* VIDEO FILLS TIKTOK */}
            <video
              ref={(el) => { videoRefs.current[video.id] = el; }}
              src={video.video_url}
              className="h-full w-full object-cover"
              loop
              playsInline
              muted={false}
              onClick={(e) => { const v = e.currentTarget; v.paused ? v.play() : v.pause(); }}
            />

            {/* NAME + CAPTION LIKE TIKTOK - BIG */}
            <div className="absolute bottom-6 left-3 right-20 text-white z-10">
              <Link to="/u/$username" params={{username: video.username}} className="block">
                <div className="font-bold text- drop-shadow-[0_2px_4px_black]">@{video.username}</div>
              </Link>
              <div className="text- mt-1 leading- line-clamp-2 drop-shadow-[0_2px_4px_black]">{video.caption}</div>
              <div className="text- mt-2 opacity-90 drop-shadow">♫ Original sound - {video.username}</div>
            </div>

            {/* RIGHT BUTTONS - REAL TIKTOK NO CIRCLES */}
            <div className="absolute bottom-24 right-3 flex flex-col gap-7 items-center">
              <div className="relative">
                <div className="h-12 w-12 rounded-full bg-white border-2 border-white flex items-center justify-center font-bold text-black text-xl">{video.username[0]?.toUpperCase()}</div>
                <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 h-5 w-5 bg-[#fe2c55] rounded-full flex items-center justify-center text-white text-">+</div>
              </div>

              <button onClick={()=>setLiked(l=>({...l, [video.id]: !l[video.id]}))} className="flex flex-col items-center active:scale-90">
                <Heart className={`h-8 w-8 drop-shadow ${liked[video.id] ? "fill-[#fe2c55] text-[#fe2c55]" : "text-white"}`} strokeWidth={2} />
                <span className="text-white font-bold text- mt-1">{formatCount(video.likes_count + (liked[video.id] ? 1 : 0))}</span>
              </button>

              <button className="flex flex-col items-center">
                <MessageCircle className="h-8 w-8 text-white drop-shadow" strokeWidth={2} />
                <span className="text-white font-bold text- mt-1">{formatCount(video.comments_count)}</span>
              </button>

              <button className="flex flex-col items-center">
                <Share2 className="h-8 w-8 text-white drop-shadow" strokeWidth={2} />
                <span className="text-white font-bold text- mt-1">Share</span>
              </button>
            </div>

          </div>
        ))}
      </div>
    </div>
  );
}
