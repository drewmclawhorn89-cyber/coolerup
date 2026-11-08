import { useState } from "react";
import { formatDuration } from "@/lib/fullVideos";
import type { YouTubeVideo } from "@/lib/youtube";

export function YouTubeVideoCard({ video, onSelect }: { video: YouTubeVideo; onSelect: (video: YouTubeVideo) => void }) {
  const duration = video.durationSeconds > 0 ? formatDuration(video.durationSeconds) : "";

  return (
    <button type="button" onClick={() => onSelect(video)} className="group min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-muted">
        <img src={video.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]" />
        {duration && <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1 py-0.5 text-[11px] font-semibold leading-none text-white tabular-nums">{duration}</span>}
        <span className="absolute bottom-1.5 left-1.5 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">YouTube</span>
      </div>
      <span className="mt-2 block line-clamp-2 text-[13px] font-semibold leading-snug text-foreground">{video.title}</span>
      <span className="mt-1 block truncate text-[12px] text-muted-foreground">{video.channelTitle}</span>
      <span className="block truncate text-[12px] text-muted-foreground">{video.viewCount ? `${Number(video.viewCount).toLocaleString()} views` : "From YouTube"}</span>
    </button>
  );
}
