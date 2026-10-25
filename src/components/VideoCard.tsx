import { useRef, useState, useEffect } from "react";
import { Heart, Share2, MessageCircle } from "lucide-react";
import { isImageUrl, resolveVideoUrl, type Video } from "@/lib/loop";
import { getSaved } from "@/lib/offline";

function formatCount(n: number) {
  if (!n) return "0";
  if (n >= 1000000) return (n/1000000).toFixed(1)+"M";
  if (n >= 1000) return (n/1000).toFixed(1)+"K";
  return n.toString();
}

export function VideoCard({ video, liked, onLikeChange }: { video: Video; liked: boolean; muted: boolean; onToggleMute: () => void; onLikeChange: (liked: boolean) => void; }) {
  const ref = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState("");
  const [progress, setProgress] = useState(0);
  const [localLiked, setLocalLiked] = useState(liked);
  const [likes, setLikes] = useState(video.likes_count);

  useEffect(() => { setLocalLiked(liked); }, [liked]);

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
        if (e.isIntersecting && e.intersectionRatio >= 0.6) v.play().catch(()=>{});
        else v.pause();
      });
    }, { threshold: 0.6 });
    obs.observe(c); return () => obs.disconnect();
  }, [src]);

  const isImage = isImageUrl(src);

  const handleLike = () => {
    const newLiked = !localLiked;
    setLocalLiked(newLiked);
    setLikes(s => s + (newLiked ? 1 : -1));
    try { onLikeChange(newLiked); } catch(e) {}
    // vibrate like TikTok
    try { navigator.vibrate(10); } catch(e) {}
  };

  return (
    <div ref={containerRef} className="relative w-full h-full bg-black flex justify-center">
      <div className="relative h-full aspect-[9/16] w-full max-w- bg-black overflow-hidden">
        {isImage ? <img src={src} className="h-full w-full object-cover" alt="video" /> :
        <video ref={ref} src={src} className="h-full w-full object-cover" loop playsInline muted={false} onTimeUpdate={(e)=>{const v=e.currentTarget; if(v.duration) setProgress((v.currentTime/v.duration)*100)}} />}

        {/* TAP TO PLAY AREA - NOT OVER BUTTONS */}
        <div className="absolute inset-0 left-0 right-16 top-0 bottom-20 z-10" onClick={()=>{const el=ref.current; if(!el)return; el.paused?el.play():el.pause()}} />

        <div className="absolute bottom-0 left-0 right-0 h- bg-white/20 z-20"><div className="h-full bg-white" style={{width:`${progress}%`}} /></div>
        
        <div className="absolute bottom-6 left-3 right-20 text-white z-20 pointer-events-none">
          <div className="font-bold text- drop-shadow-[0_2px_4px_black] pointer-events-auto">@{video.username}</div>
          <div className="text- mt-1 line-clamp-2 drop-shadow-[0_2px_4px_black]">{video.caption}</div>
        </div>

        {/* BUTTONS CONTAINER - ON TOP WITH HIGH Z-INDEX */}
        <div className="absolute bottom-24 right-2 flex flex-col gap-6 items-center z-[999] pointer-events-auto">
          
          <div className="h-12 w-12 rounded-full bg-white border-2 border-white flex items-center justify-center font-bold text-black text-xl">{video.username[0]?.toUpperCase()}</div>

          <div
            onClick={handleLike}
            className="flex flex-col items-center cursor-pointer select-none"
            style={{ pointerEvents: 'auto' }}
          >
            <Heart className={`h-9 w-9 ${localLiked ? "fill-[#fe2c55] text-[#fe2c55]" : "text-white"} `} fill={localLiked ? "#fe2c55" : "none"} />
            <span className="text-white font-bold text-xs mt-1">{formatCount(likes)}</span>
          </div>

          <div className="flex flex-col items-center cursor-pointer" style={{ pointerEvents: 'auto' }} onClick={()=>alert("Comments coming soon!")}>
            <MessageCircle className="h-9 w-9 text-white" />
            <span className="text-white font-bold text-xs mt-1">{formatCount(video.comments_count)}</span>
          </div>

          <div className="flex flex-col items-center cursor-pointer" style={{ pointerEvents: 'auto' }} onClick={async()=>{
            try {
              if (navigator.share) await navigator.share({title: video.caption, url: location.href});
              else { await navigator.clipboard.writeText(location.href); alert("Link copied!"); }
            } catch(e) { await navigator.clipboard.writeText(location.href); alert("Link copied!"); }
          }}>
            <Share2 className="h-9 w-9 text-white" />
            <span className="text-white font-bold text-xs mt-1">Share</span>
          </div>

        </div>
      </div>
    </div>
  );
}
