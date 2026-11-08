import { useEffect, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import type { YouTubeVideo } from "@/lib/youtube";

/** Embeds YouTube's official player; video bytes stay on YouTube. */
export function YouTubeEmbed({ video, onClose }: { video: YouTubeVideo; onClose: () => void }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const youtubeUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`;
  const embedUrl = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.id)}?autoplay=1&controls=1&playsinline=1${origin ? `&origin=${encodeURIComponent(origin)}` : ""}`;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={`Watch ${video.title}`}>
      <div className="w-full max-w-5xl overflow-hidden rounded-xl bg-background shadow-2xl">
        <div className="flex items-center justify-between gap-3 p-3">
          <h2 className="min-w-0 truncate text-sm font-semibold">{video.title}</h2>
          <button type="button" onClick={onClose} aria-label="Close video" className="rounded-full p-2 hover:bg-accent"><X className="h-5 w-5" /></button>
        </div>
        <div className="aspect-video w-full bg-black">
          <iframe title={video.title} src={embedUrl} className="h-full w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 p-3">
          <div className="min-w-0"><p className="truncate text-sm font-semibold">{video.title}</p><p className="truncate text-xs text-muted-foreground">{video.channelTitle} · YouTube</p></div>
          <a href={youtubeUrl} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">Watch on YouTube <ExternalLink className="h-4 w-4" /></a>
        </div>
      </div>
    </div>
  );
}
