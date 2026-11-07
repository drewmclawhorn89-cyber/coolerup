import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Play } from "lucide-react";
import {
  formatDuration,
  formatViews,
  resolveFullVideoUrl,
  timeAgo,
  type FullVideo,
} from "@/lib/fullVideos";

/**
 * One cell in the /videos grid — YouTube's "home" card.
 *
 * Horizontal 16:9 thumbnail with the duration burned into the bottom-right
 * corner, then the title, channel handle, views and relative time underneath.
 * Nothing overlays the thumbnail except the duration badge, which is what makes
 * this read as YouTube rather than TikTok.
 */
export function FullVideoCard({ video }: { video: FullVideo }) {
  const [thumb, setThumb] = useState<string>("");

  useEffect(() => {
    let alive = true;
    if (!video.thumbnail_url) return;
    void resolveFullVideoUrl(video.thumbnail_url).then((u) => {
      if (alive) setThumb(u);
    });
    return () => {
      alive = false;
    };
  }, [video.thumbnail_url]);

  return (
    <Link
      to="/watch/$id"
      params={{ id: video.id }}
      className="group block min-w-0 focus-visible:outline-none"
      aria-label={`${video.title} by ${video.username}`}
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-muted">
        {thumb ? (
          <img
            src={thumb}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-secondary text-muted-foreground">
            <Play className="h-8 w-8" />
          </div>
        )}

        {/* Duration badge, bottom-right like YouTube. */}
        {video.duration > 0 && (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1 py-0.5 text-[11px] font-semibold leading-none text-white tabular-nums">
            {formatDuration(video.duration)}
          </span>
        )}
      </div>

      <div className="mt-2 min-w-0">
        <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug text-foreground">
          {video.title}
        </h3>
        <p className="mt-1 truncate text-[12px] text-muted-foreground">@{video.username}</p>
        <p className="truncate text-[12px] text-muted-foreground">
          {formatViews(video.views)} · {timeAgo(video.created_at)}
        </p>
      </div>
    </Link>
  );
}
