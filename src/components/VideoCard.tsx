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
  const [src, setSrc] = useState("");
  const [localLiked, setLocalLiked] = useState(liked);
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

  const isImage = isImageUrl(src);

  return (
    <div className="relative w-full h-[calc(100dvh-88px)] bg-black flex justify-center overflow-hidden">
      
      {/* VIDEO */}
      <div className="absolute inset-0">
        {isImage ? <img src={src} className="h-full w-full object-cover" /> :
        <video ref={ref} src={src} className="h-full w-full object-cover" loop playsInline muted={false} autoPlay />}
      </div>

      {/* NAME */}
      <div className="absolute bottom-6 left-3 right-20 text-white z-10">
        <div className="font-bold text-">@{video.username}</div>
        <div className="text- mt-1 line-clamp-2">{video.caption}</div>
      </div>

      {/* BUTTONS - BRIGHT RED BACKGROUND SO YOU CAN SEE - Z-INDEX 9999 - THIS WILL WORK */}
      <div className="absolute bottom-24 right-3 flex flex-col gap-5 items-center z-[9999] bg-red-500/20 p-2 rounded-xl">
        
        <div 
          className="w-14 h-14 bg-white rounded-full flex items-center justify-center cursor-pointer"
          onClick={() => {
            alert("LIKE WORKS!");
            const nl = !localLiked;
            setLocalLiked(nl);
            setLikes(s => s + (nl ? 1 : -1));
            try { onLikeChange(nl); } catch(e) {}
          }}
        >
          <Heart className={`h-8 w-8 ${localLiked ? "fill-red-500 text-red-500" : "text-black"}`} />
        </div>
        <span className="text-white font-bold text-xs bg-black px-1 rounded">{formatCount(likes)}</span>

        <div 
          className="w-14 h-14 bg-white rounded-full flex items-center justify-center cursor-pointer"
          onClick={() => alert("COMMENT BUTTON WORKS!")}
        >
          <MessageCircle className="h-8 w-8 text-black" />
        </div>
        <span className="text-white font-bold text-xs bg-black px-1 rounded">{formatCount(video.comments_count)}</span>

        <div 
          className="w-14 h-14 bg-white rounded-full flex items-center justify-center cursor-pointer"
          onClick={() => {
            alert("SHARE WORKS!");
            navigator.clipboard.writeText(location.href);
          }}
        >
          <Share2 className="h-8 w-8 text-black" />
        </div>
        <span className="text-white font-bold text-xs bg-black px-1 rounded">Share</span>

      </div>
    </div>
  );
}
