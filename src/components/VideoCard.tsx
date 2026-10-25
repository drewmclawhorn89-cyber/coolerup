import { useRef, useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { Heart, Share2, MessageCircle } from "lucide-react";
import { formatCount, isImageUrl, resolveVideoUrl, type Video } from "@/lib/loop";
import { getSaved } from "@/lib/offline";

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
  const containerRef = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState("");
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [likes, setLikes] = useState(video.likes_count);

  useEffect(() => {
    let blobUrl = "";
    (async () => {
      const saved = await getSaved(video.id);
      if (saved) {
        blobUrl = URL.createObjectURL(saved.blob);
        setSrc(blobUrl);
      } else {
        const u = await resolveVideoUrl(video.video_url);
        setSrc(u);
      }
    })();
    return () => { if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [video.id, video.video_url]);

  useEffect(() => {
    const video = ref.current;
    const container = containerRef.current;
    if (!video || !container || !src) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.7) {
            video.play().catch(() => {});
            setPlaying(true);
          } else {
            video.pause();
            setPlaying(false);
          }
        });
      },
      { threshold: 0.7 }
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [src]);

  const togglePlay = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) { el.play(); setPlaying(true); }
    else { el.pause(); setPlaying(false); }
  };

  const isImage = isImageUrl(src);

  return (
    <div className="relative w-full h-[calc(100dvh-88px)] bg-black flex justify-center overflow-hidden">
      <div ref={containerRef} className="relative h-full aspect-[9/16] w-full max-w- bg-black">
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
            onClick={togglePlay}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (v.duration) setProgress((v.currentTime / v.duration) * 100);
            }}
          />
        )}

        <div className="absolute bottom-0 left-0 right-0 h- bg-white/30">
          <div className="h-full bg-white" style={{ width: `${progress}%` }} />
        </div>

        <div className="absolute bottom-4 left-3 right-20 text-white">
          <Link to="/u/$username" params={{ username: video.username }} className="font-bold text- drop-shadow-lg">@{video.username}</Link>
          <p className="text- mt-1 line-clamp-2 drop-shadow-lg">{video.caption}</p>
        </div>

        {/* TRUE TIKTOK BUTTONS - NO CIRCLES, JUST ICONS */}
        <div className="absolute bottom-20 right-3 flex flex-col gap-7 items-center">
          {/* Profile with + */}
          <div className="relative">
            <div className="h-12 w-12 rounded-full bg-gray-300 flex items-center justify-center text-black font-bold text-xl border-2 border-white">
              {video.username[0]?.toUpperCase()}
            </div>
            <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 h-5 w-5 bg-[#fe2c55] rounded-full flex items-center justify-center text-white text-xs font-bold">+</div>
          </div>

          {/* LIKE - REAL TIKTOK */}
          <button
            onClick={() => {
              const n = !liked;
              onLikeChange(n);
              setLikes(s => s + (n ? 1 : -1));
            }}
            className="flex flex-col items-center active:scale-90 transition"
          >
            <Heart className={`h-9 w-9 drop-shadow-lg ${liked ? "fill-[#fe2c55] text-[#fe2c55]" : "text-white"}`} strokeWidth={liked ? 0 : 2} />
            <span className="text-white font-bold text- mt-1 drop-shadow-lg">{formatCount(likes)}</span>
          </button>

          {/* COMMENT - REAL TIKTOK */}
          <button className="flex flex-col items-center">
            <MessageCircle className="h-9 w-9 text-white drop-shadow-lg fill-white/0" strokeWidth={2} />
            <span className="text-white font-bold text- mt-1 drop-shadow-lg">{formatCount(video.comments_count)}</span>
          </button>

          {/* SHARE - REAL TIKTOK */}
          <button className="flex flex-col items-center active:scale-90 transition">
            <Share2 className="h-9 w-9 text-white drop-shadow-lg" strokeWidth={2} />
            <span className="text-white font-bold text- mt-1 drop-shadow-lg">Share</span>
          </button>
        </div>
      </div>
    </div>
  );
}
