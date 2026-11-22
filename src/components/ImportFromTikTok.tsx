import { useCallback, useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  importTikTokVideo,
  importedTikTokIds,
  listMyTikTokVideos,
  type OwnTikTokVideo,
} from "@/lib/tiktokLink";

/**
 * "Import from TikTok" picker.
 *
 * The list comes from `/api/tiktok/videos`, which calls TikTok's `video.list`
 * with the caller's own stored token. That endpoint is scoped by TikTok to the
 * authorised account, and there is no handle parameter anywhere in this
 * component — so it can only ever offer the user's own videos.
 */
export function ImportFromTikTok({
  username,
  open,
  onOpenChange,
}: {
  username: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const auth = useAuth();
  const [videos, setVideos] = useState<OwnTikTokVideo[] | null>(null);
  const [already, setAlready] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [page, imported] = await Promise.all([listMyTikTokVideos(0), importedTikTokIds()]);
      setVideos(page.videos);
      setAlready(imported);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your TikTok videos.");
      setVideos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const handleImport = async (video: OwnTikTokVideo) => {
    const userId = auth.user?.id;
    const coolerupUsername = auth.profile?.username ?? auth.profile?.handle;
    if (!userId || !coolerupUsername) {
      toast.error("Finish setting up your Coolerup profile first.");
      return;
    }
    setImporting(video.id);
    try {
      await importTikTokVideo({ video, username: coolerupUsername, userId });
      setDone((prev) => new Set(prev).add(video.id));
      toast.success("Imported to your Coolerup feed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(null);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Import from TikTok"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl sm:rounded-2xl"
        style={{ backgroundColor: "black", color: "white" }}
      >
        <div className="flex items-center justify-between border-b p-4" style={{ borderColor: "#222" }}>
          <div>
            <h3 className="text-sm font-bold" style={{ color: "white" }}>
              Import from TikTok
            </h3>
            <p className="text-xs" style={{ color: "#9ca3af" }}>
              Your videos from @{username}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md px-3 py-1.5 text-xs font-semibold"
            style={{ backgroundColor: "#333", color: "white" }}
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-10" style={{ color: "#9ca3af" }}>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading your videos…</span>
            </div>
          )}

          {!loading && error && (
            <div className="rounded-lg p-3 text-sm" style={{ backgroundColor: "#1a1a1a", color: "#fca5a5" }}>
              {error}
            </div>
          )}

          {!loading && !error && videos?.length === 0 && (
            <p className="py-10 text-center text-sm" style={{ color: "#9ca3af" }}>
              No videos found on @{username}.
            </p>
          )}

          {!loading && !error && (videos?.length ?? 0) > 0 && (
            <ul className="space-y-2">
              {videos!.map((video) => {
                const isDone = done.has(video.id) || already.has(video.id);
                const isBusy = importing === video.id;
                return (
                  <li
                    key={video.id}
                    className="flex items-center gap-3 rounded-lg p-2"
                    style={{ backgroundColor: "#111" }}
                  >
                    {video.coverUrl ? (
                      <img
                        src={video.coverUrl}
                        alt=""
                        className="h-16 w-12 shrink-0 rounded object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="h-16 w-12 shrink-0 rounded" style={{ backgroundColor: "#222" }} />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-xs" style={{ color: "white" }}>
                        {video.description || video.title || "Untitled"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleImport(video)}
                      disabled={isDone || isBusy}
                      className="flex shrink-0 items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                      style={{ backgroundColor: isDone ? "#333" : "#FE2C55", color: "white" }}
                    >
                      {isBusy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : isDone ? (
                        <Check className="h-3 w-3" />
                      ) : null}
                      {isDone ? "Imported" : "Import"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
