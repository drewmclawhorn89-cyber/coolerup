import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Film, Loader2, Play, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { embedUrlFor } from "@/lib/coolerupBrowser";
import { resolveFullVideoUrl } from "@/lib/fullVideos";
import { resolveVideoUrl } from "@/lib/loop";
import {
  clearWatchHistory,
  formatWatchedWhen,
  removeWatchHistoryItem,
  sourceLabel,
  useSaveWatchHistorySetting,
  useWatchHistory,
  WATCH_HISTORY_RED,
  type WatchHistoryItem,
} from "@/lib/watchHistory";

export const Route = createFileRoute("/watch-history")({
  head: () => ({
    meta: [
      { title: "Watch History — Coolerup" },
      { name: "description", content: "View and manage your Coolerup Watch History." },
    ],
  }),
  component: WatchHistoryPage,
});

function useResolvedMediaUrl(rawUrl: string): string {
  const [resolved, setResolved] = useState(() =>
    rawUrl && !rawUrl.startsWith("storage:") ? rawUrl : "",
  );

  useEffect(() => {
    let alive = true;
    if (!rawUrl) {
      setResolved("");
      return;
    }
    if (!rawUrl.startsWith("storage:")) {
      setResolved(rawUrl);
      return;
    }
    const resolver = resolveFullVideoUrl(rawUrl).then((url) => url || resolveVideoUrl(rawUrl));
    void resolver.then((url) => {
      if (alive) setResolved(url);
    });
    return () => {
      alive = false;
    };
  }, [rawUrl]);

  return resolved;
}

function HistoryThumbnail({ item }: { item: WatchHistoryItem }) {
  const resolvedThumb = useResolvedMediaUrl(item.thumbnailUrl);
  const resolvedVideo = useResolvedMediaUrl(!item.thumbnailUrl ? item.videoUrl : "");

  if (resolvedThumb) {
    return (
      <img
        src={resolvedThumb}
        alt={item.title}
        className="h-full w-full object-cover"
        loading="lazy"
      />
    );
  }

  if (resolvedVideo && item.source === "foryou") {
    return (
      <video
        src={resolvedVideo}
        muted
        playsInline
        preload="metadata"
        className="h-full w-full object-cover"
      />
    );
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center bg-zinc-900 text-white/50">
      <Film className="h-5 w-5" />
    </div>
  );
}

function HistoryReplayModal({
  item,
  onClose,
}: {
  item: WatchHistoryItem | null;
  onClose: () => void;
}) {
  const resolvedVideoUrl = useResolvedMediaUrl(item?.videoUrl ?? "");
  if (!item) return null;

  const ytEmbed = item.youtubeId
    ? `https://www.youtube.com/embed/${encodeURIComponent(item.youtubeId)}?autoplay=1&rel=0&playsinline=1`
    : item.sourceUrl
      ? embedUrlFor(item.sourceUrl)
      : null;

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl border-white/15 bg-black p-0 text-white">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <DialogTitle className="truncate text-sm font-semibold text-white">
              {item.title}
            </DialogTitle>
            <DialogDescription className="truncate text-xs text-white/60">
              @{item.creator} · {sourceLabel(item.source)}
            </DialogDescription>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close player"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="bg-black p-3">
          {ytEmbed ? (
            <div className="aspect-video w-full overflow-hidden rounded-lg bg-black">
              <iframe
                src={ytEmbed}
                title={item.title}
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            </div>
          ) : resolvedVideoUrl ? (
            <video
              src={resolvedVideoUrl}
              controls
              autoPlay
              playsInline
              className="max-h-[70dvh] w-full rounded-lg bg-black object-contain"
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-zinc-900 text-sm text-white/60">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading video...
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function WatchHistoryPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const userId = auth.user?.id ?? null;
  const { items, loading } = useWatchHistory(userId);
  const [saveEnabled, setSaveEnabled] = useSaveWatchHistorySetting(userId);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [replayItem, setReplayItem] = useState<WatchHistoryItem | null>(null);

  const handleToggleSave = () => {
    const next = !saveEnabled;
    setSaveEnabled(next);
    toast.success(next ? "Save Watch History: ON" : "Save Watch History: OFF");
  };

  const handleDeleteOne = async (item: WatchHistoryItem) => {
    await removeWatchHistoryItem(userId, item.id);
    toast.success("Removed from Watch History");
  };

  const handleConfirmClear = async () => {
    setClearing(true);
    try {
      await clearWatchHistory(userId);
      setConfirmClearOpen(false);
      toast.success("Watch History cleared");
    } finally {
      setClearing(false);
    }
  };

  const handleReplay = (item: WatchHistoryItem) => {
    if (item.watchRouteId) {
      void navigate({ to: "/watch/$id", params: { id: item.watchRouteId } });
      return;
    }
    const directEmbed =
      item.youtubeId || (item.sourceUrl ? embedUrlFor(item.sourceUrl) : null) || item.videoUrl;
    if (directEmbed) {
      setReplayItem(item);
      return;
    }
    if (item.sourceUrl) {
      void navigate({ to: "/browser", search: { url: item.sourceUrl } as never });
    }
  };

  if (auth.ready && !auth.user) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-black p-6 text-center text-white">
        <h1 className="font-display text-2xl font-bold text-white">Watch History</h1>
        <p className="max-w-sm text-sm text-white/70">
          Sign in to view and manage your account&apos;s Watch History.
        </p>
        <button
          type="button"
          onClick={auth.signIn}
          className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
          style={{ backgroundColor: WATCH_HISTORY_RED }}
        >
          Sign in
        </button>
        <Link to="/settings" className="text-sm text-white/60 hover:text-white">
          Back to Settings
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-black text-white">
      <div className="mx-auto max-w-2xl px-4 pb-16 pt-5">
        {/* Header with Clear All Watch History button */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <Link
              to="/settings"
              aria-label="Back to settings"
              className="flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="font-display text-xl font-bold text-white">Watch History</h1>
          </div>

          <button
            type="button"
            onClick={() => setConfirmClearOpen(true)}
            disabled={items.length === 0 || clearing}
            className="rounded-lg px-3.5 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: WATCH_HISTORY_RED }}
          >
            Clear All Watch History
          </button>
        </div>

        {/* Save Watch History ON/OFF toggle */}
        <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-zinc-950 px-4 py-3.5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">Save Watch History</p>
            <p className="mt-0.5 text-xs text-white/60">
              {saveEnabled
                ? "Videos watched for more than 3 seconds are saved to your account."
                : "Paused — new videos will not be saved to your Watch History."}
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={saveEnabled}
            aria-label="Save Watch History"
            onClick={handleToggleSave}
            className="flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition"
            style={{ backgroundColor: saveEnabled ? WATCH_HISTORY_RED : "#333333" }}
          >
            <span
              className="h-5 w-5 rounded-full bg-white transition"
              style={{ transform: saveEnabled ? "translateX(20px)" : "translateX(0)" }}
            />
          </button>
        </div>

        {/* History list */}
        <div className="mt-5">
          {loading && items.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-white/60">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading watch history...
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-zinc-950 px-6 py-14 text-center">
              <p className="text-base font-semibold text-white">No watch history yet</p>
              <p className="mt-1 text-sm text-white/60">
                Videos you watch for more than 3 seconds appear here, newest first.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-zinc-950 p-2.5 transition hover:border-white/25"
                >
                  <button
                    type="button"
                    onClick={() => handleReplay(item)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <div className="relative h-20 w-32 shrink-0 overflow-hidden rounded-lg bg-zinc-900">
                      <HistoryThumbnail item={item} />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition hover:opacity-100">
                        <Play className="h-6 w-6 fill-white text-white" />
                      </span>
                      <span className="absolute bottom-1 left-1 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {sourceLabel(item.source)}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-semibold leading-snug text-white">
                        {item.title}
                      </p>
                      <p className="mt-1 truncate text-xs text-white/75">@{item.creator}</p>
                      <p className="mt-0.5 text-xs text-white/50">
                        {formatWatchedWhen(item.watchedAt)}
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleDeleteOne(item)}
                    aria-label={`Delete ${item.title} from history`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Clear All confirmation dialog */}
      <Dialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
        <DialogContent className="max-w-sm border-white/15 bg-zinc-950 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">Clear all history?</DialogTitle>
            <DialogDescription className="text-white/70">
              This will permanently remove all videos from your account&apos;s Watch History.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2 flex gap-2 sm:justify-end">
            <button
              type="button"
              onClick={() => setConfirmClearOpen(false)}
              className="rounded-lg border border-white/20 bg-transparent px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={clearing}
              onClick={() => void handleConfirmClear()}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: WATCH_HISTORY_RED }}
            >
              {clearing ? "Clearing..." : "Clear All"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <HistoryReplayModal item={replayItem} onClose={() => setReplayItem(null)} />
    </div>
  );
}
