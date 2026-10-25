import { useRef, useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { Play, Heart } from "lucide-react";
import { formatCount, isImageUrl, resolveVideoUrl, type Video } from "@/lib/loop";
import { getSaved } from "@/lib/offline";
import { Button } from "@/components/ui/button";

export function VideoCard({
  video,
  liked,
  onLikeChange,
}: {
  video: Video;
  liked: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onLikeChange: (liked: boolean) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState("");
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [likes, setLikes] = useState(video.likes_count);
  const [showComments, setShowComments] = useState(false);

  useEffect(() => {
    let alive = true;
    let blobUrl1 = "";
    (async () => {
      const saved = await getSaved(video.id);
      if (saved) {
        blobUrl1 = URL.createObjectURL(saved.blob);
        setSrc(blobUrl1);
      } else {
        const u = await resolveVideoUrl(video.video_url);
        if (alive) setSrc(u);
      }
    })();
    return () => {
      alive = false;
      if (blobUrl1) URL.revokeObjectURL(blobUrl1);
    };
  }, [video.id, video.video_url]);

  const togglePlay = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) { el.play(); setPlaying(true); }
    else { el.pause(); setPlaying(false); }
  };

  const isImage = isImageUrl(src);

  return (
    <div className="relative w-full h-[calc(100dvh-88px)] md:h-[calc(100dvh-64px)] bg-black overflow-hidden flex justify-center">
      {/* VIDEO FILLS TIKTOK STYLE - CENTERED 9:16 */}
      <div className="relative h-full aspect-[9/16] w-full max-w- bg-black overflow-hidden">
        {isImage ? (
          <img src={src} className="h-full w-full object-cover" alt="" />
        ) : (
          <video
            ref={ref}
            src={src}
            className="h-full w-full object-cover cursor-pointer"
            loop
            playsInline
            muted={false}
            autoPlay
            onClick={togglePlay}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (v.duration) setProgress((v.currentTime / v.duration) * 100);
            }}
          />
        )}

        {/* CENTER PLAY - ONLY WHEN PAUSED */}
        {!playing && !isImage && src && (
          <Button variant="ghost" size="icon"
            onClick={togglePlay}
            className="absolute inset-0 m-auto flex h-16 w-16 items-center justify-center rounded-full bg-black/40 text-white"
          >
            <Play className="ml-1 h-7 w-7 fill-white" />
          </Button>
        )}

        {/* BOTTOM PROGRESS */}
        <div className="absolute inset-x-0 bottom-0 h- bg-white/20">
          <div className="h-full bg-white" style={{ width: `${progress}%` }} />
        </div>

        {/* BOTTOM CAPTION - TIKTOK LINED UP */}
        <div className="absolute bottom-3 left-3 right-16 text-white">
          <Link to="/u/$username" params={{ username: video.username }} className="break-words text- font-bold">
            @{video.username}
          </Link>
          <p className="mt-1 line-clamp-2 text-">{video.caption}</p>
        </div>

        {/* RIGHT SIDE - TIKTOK ALIGNED */}
        <div className="absolute bottom-16 right-2 flex flex-col items-center gap-5">
          <div className="h-12 w-12 rounded-full bg-[#ff2d55] flex items-center justify-center font-bold text-white text-xl">
            {video.username[0]?.toUpperCase()}
          </div>
          <div className="flex flex-col items-center gap-1">
            <button onClick={() => { const n=!liked; onLikeChange(n); setLikes(s=>s+(n?1:-1)); }} className="h-12 w-12 rounded-full bg-white/15 flex items-center justify-center backdrop-blur">
              <Heart className={`h-7 w-7 ${liked ? "fill-[#ff2d55] text-[#ff2d55]" : "text-white"}`} />
            </button>
            <span className="text-xs font-bold text-white">{formatCount(likes)}</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <button className="h-12 w-12 rounded-full bg-white/15 flex items-center justify-center backdrop-blur text-white">💬</button>
            <span className="text-xs font-bold text-white">{formatCount(video.comments_count)}</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <button className="h-12 w-12 rounded-full bg-white/15 flex items-center justify-center backdrop-blur text-white">↗️</button>
            <span className="text-xs font-bold text-white">{formatCount(video.shares_count)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
