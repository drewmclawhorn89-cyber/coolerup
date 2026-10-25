import { useRef, useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { Heart, Share2, MessageCircle } from "lucide-react";
import { formatCount, isImageUrl, resolveVideoUrl, type Video } from "@/lib/loop";
import { getSaved } from "@/lib/offline";

export function VideoCard({ video, liked, onLikeChange }: { video: Video; liked: boolean; muted: boolean; onToggleMute: () => void; onLikeChange: (liked: boolean) => void; }) {
  const ref = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState("");
  const [progress, setProgress] = useState(0);
  const [likes, setLikes] = useState(video.likes_count);

  useEffect(() => {
    let blobUrl = "";
    (async () => {
      const saved = await getSaved(video.id);
      if (saved) { blobUrl = URL.createObjectURL(saved.blob); setSrc(blobUrl); }
      else { const u = await resolveVideoUrl(video.video_url); setSrc(u); }
    })();
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [video.id, video.video_url]);

  useEffect(() => {
    const v = ref.current; const c = containerRef.current;
    if (!v || !c || !src) return;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting && e.intersectionRatio >= 0.8) v.play().catch(()=>{});
        else v.pause();
      });
    }, { threshold: 0.8 });
    obs.observe(c); return () => obs.disconnect();
  }, [src]);

  const isImage = isImageUrl(src);

  return (
    <div ref={containerRef} className="relative w-full h-full bg-black flex justify-center">
      <div className="relative h-full aspect-[9/16] w-full max-w- bg-black overflow-hidden">
        {isImage ? <img src={src} className="h-full w-full object-cover" /> :
        <video ref={ref} src={src} className="h-full w-full object-cover" loop playsInline muted={false} onClick={()=>{const el=ref.current; if(!el)return; el.paused?el.play():el.pause()}} onTimeUpdate={(e)=>{const v=e.currentTarget; if(v.duration) setProgress((v.currentTime/v.duration)*100)}} />}
        
        <div className="absolute bottom-0 left-0 right-0 h- bg-white/20"><div className="h-full bg-white" style={{width:`${progress}%`}} /></div>
        
        <div className="absolute bottom-6 left-3 right-20 text-white z-20">
          <div className="font-bold text- drop-shadow-[0_2px_4px_black]">@{video.username}</div>
          <div className="text- mt-1 leading- line-clamp-2 drop-shadow-[0_2px_4px_black]">{video.caption}</div>
          <div className="text- mt-2 opacity-90">♫ {video.username} - Original sound</div>
        </div>

        <div className="absolute bottom-24 right-3 flex flex-col gap-7 items-center z-50">
          <div className="relative">
            <div className="h-12 w-12 rounded-full bg-white border-2 border-white flex items-center justify-center font-bold text-black text-xl">{video.username[0]?.toUpperCase()}</div>
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 h-5 w-5 bg-[#fe2c55] rounded-full flex items-center justify-center text-white text-">+</div>
          </div>

          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const n = !liked;
              onLikeChange(n);
              setLikes(s=>s+(n?1:-1));
            }}
            className="flex flex-col items-center active:scale-90 z-50 pointer-events-auto"
          >
            <Heart className={`h-8 w-8 ${liked?"fill-[#fe2c55] text-[#fe2c55]":"text-white"}`} />
            <span className="text-white font-bold text-xs mt-1">{formatCount(likes)}</span>
          </button>

          <button type="button" onPointerDown={(e)=>{e.preventDefault(); e.stopPropagation();}} className="flex flex-col items-center z-50 pointer-events-auto">
            <MessageCircle className="h-8 w-8 text-white" />
            <span className="text-white font-bold text-xs mt-1">{formatCount(video.comments_count)}</span>
          </button>

          <button
            type="button"
            onPointerDown={(e)=>{
              e.preventDefault();
              e.stopPropagation();
              if (navigator.share) navigator.share({title: video.caption, url: location.href});
              else { navigator.clipboard.writeText(location.href); alert("Link copied"); }
            }}
            className="flex flex-col items-center z-50 pointer-events-auto"
          >
            <Share2 className="h-8 w-8 text-white" />
            <span className="text-white font-bold text-xs mt-1">Share</span>
          </button>
        </div>
      </div>
    </div>
  );
}
