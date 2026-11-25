import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  EyeOff,
  Film,
  Image as ImageIcon,
  Lock,
  Search,
  Sparkles,
  Video as VideoIcon,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  fetchCoolerupVideosForDm,
  resolveDmMediaUrl,
  type CoolerupVideoChoice,
  type DmMediaPermission,
} from "@/lib/dmMedia";
import { Button } from "@/components/ui/button";

export function DmAttachmentSheet({
  open,
  onClose,
  onPickFile,
  onOpenGif,
  onPickCoolerupVideo,
  viewOnce,
  onToggleViewOnce,
  permission,
  uploading,
}: {
  open: boolean;
  onClose: () => void;
  onPickFile: (file: File) => void;
  onOpenGif: () => void;
  onPickCoolerupVideo: (video: CoolerupVideoChoice) => void;
  viewOnce: boolean;
  onToggleViewOnce: () => void;
  permission: DmMediaPermission | null;
  uploading: boolean;
}) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [coolerupPickerOpen, setCoolerupPickerOpen] = useState(false);

  const mediaBlocked = permission !== null && !permission.allowed;

  const guardMedia = (action: () => void) => {
    if (uploading) return;
    if (mediaBlocked) {
      toast.error(
        permission?.reason ||
          "Only mutual followers can send pics & videos unless this user has 'Allow messages from everyone' on in Settings.",
      );
      return;
    }
    action();
  };

  if (!open) {
    return coolerupPickerOpen ? (
      <CoolerupVideoPickerModal
        onClose={() => setCoolerupPickerOpen(false)}
        onSelect={(video) => {
          setCoolerupPickerOpen(false);
          onPickCoolerupVideo(video);
        }}
      />
    ) : null;
  }

  return (
    <>
      <div className="border-t border-white/15 bg-black px-3 pb-3 pt-2.5 text-white">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-white/70">
              Send media
            </span>
            {mediaBlocked && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-400">
                <Lock className="h-3 w-3" />
                Mutuals or Everyone only
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={viewOnce}
              onClick={onToggleViewOnce}
              className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition ${
                viewOnce
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-white/20 bg-zinc-900 text-white hover:border-white/40"
              }`}
            >
              <EyeOff className="h-3.5 w-3.5" />
              <span>View Once {viewOnce ? "ON" : "OFF"}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close attachment menu"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-white/70 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-1.5">
          <button
            type="button"
            disabled={uploading}
            onClick={() => guardMedia(() => cameraInputRef.current?.click())}
            className={`flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-zinc-950 px-1 py-2 text-center transition hover:bg-zinc-900 ${
              mediaBlocked ? "opacity-50" : ""
            }`}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Camera className="h-4 w-4" />
            </span>
            <span className="text-[11px] font-semibold leading-tight text-white">Camera</span>
          </button>

          <button
            type="button"
            disabled={uploading}
            onClick={() => guardMedia(() => photoInputRef.current?.click())}
            className={`flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-zinc-950 px-1 py-2 text-center transition hover:bg-zinc-900 ${
              mediaBlocked ? "opacity-50" : ""
            }`}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary">
              <ImageIcon className="h-4 w-4" />
            </span>
            <span className="text-[11px] font-semibold leading-tight text-white">
              Photo Library
            </span>
          </button>

          <button
            type="button"
            disabled={uploading}
            onClick={() => guardMedia(() => videoInputRef.current?.click())}
            className={`flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-zinc-950 px-1 py-2 text-center transition hover:bg-zinc-900 ${
              mediaBlocked ? "opacity-50" : ""
            }`}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary">
              <VideoIcon className="h-4 w-4" />
            </span>
            <span className="text-[11px] font-semibold leading-tight text-white">Video</span>
          </button>

          <button
            type="button"
            disabled={uploading}
            onClick={() => {
              onClose();
              onOpenGif();
            }}
            className="flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-zinc-950 px-1 py-2 text-center transition hover:bg-zinc-900"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="text-[11px] font-semibold leading-tight text-white">GIF</span>
          </button>

          <button
            type="button"
            disabled={uploading}
            onClick={() => guardMedia(() => setCoolerupPickerOpen(true))}
            className={`flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-zinc-950 px-1 py-2 text-center transition hover:bg-zinc-900 ${
              mediaBlocked ? "opacity-50" : ""
            }`}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Film className="h-4 w-4" />
            </span>
            <span className="text-[11px] font-semibold leading-tight text-white">
              Coolerup Video
            </span>
          </button>
        </div>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*,video/*"
          capture="environment"
          aria-label="Capture photo or video with camera"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onPickFile(file);
          }}
        />
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          aria-label="Choose photo from library"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onPickFile(file);
          }}
        />
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          aria-label="Choose video from device"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onPickFile(file);
          }}
        />
      </div>

      {coolerupPickerOpen && (
        <CoolerupVideoPickerModal
          onClose={() => setCoolerupPickerOpen(false)}
          onSelect={(video) => {
            setCoolerupPickerOpen(false);
            onPickCoolerupVideo(video);
          }}
        />
      )}
    </>
  );
}

function CoolerupVideoPickerModal({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (video: CoolerupVideoChoice) => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [items, setItems] = useState<CoolerupVideoChoice[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [resolvedMap, setResolvedMap] = useState<Record<string, string>>({});

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  const loadPage = useCallback(
    async (offset: number, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      try {
        const res = await fetchCoolerupVideosForDm({
          limit: 10,
          offset,
          query: debouncedQuery,
        });
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
        setHasMore(res.hasMore);

        const pairs = await Promise.all(
          res.items.map(async (item) => {
            const url = await resolveDmMediaUrl(item.video_url);
            return [item.id, url] as const;
          }),
        );
        setResolvedMap((prev) => {
          const next = { ...prev };
          for (const [id, url] of pairs) {
            if (url) next[id] = url;
          }
          return next;
        });
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [debouncedQuery],
  );

  useEffect(() => {
    void loadPage(0, false);
  }, [loadPage]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/85 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[82dvh] w-full max-w-md flex-col rounded-t-3xl border border-white/15 bg-black p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-white sm:rounded-3xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-white">Coolerup Videos</h2>
            <p className="text-xs text-white/60">Pick a video from Coolerup to send</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Coolerup Video picker"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-white/70 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search @creator or caption..."
            className="w-full rounded-full border border-white/15 bg-zinc-900 py-2 pl-9 pr-4 text-sm text-white placeholder:text-white/40 outline-none focus:border-primary"
          />
        </div>

        <div className="flex-1 overflow-y-auto pr-0.5">
          {loading ? (
            <div className="grid grid-cols-2 gap-2.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="aspect-[9/14] animate-pulse rounded-xl bg-zinc-800" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="py-12 text-center text-sm text-white/60">No Coolerup videos found.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {items.map((video) => {
                const src = resolvedMap[video.id];
                const isImage = /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(video.video_url);
                return (
                  <button
                    key={video.id}
                    type="button"
                    onClick={() => onSelect(video)}
                    className="group relative flex aspect-[9/14] flex-col justify-end overflow-hidden rounded-xl border border-white/15 bg-zinc-900 text-left transition hover:border-primary"
                  >
                    {src ? (
                      isImage ? (
                        <img
                          src={src}
                          alt={video.caption || `@${video.username}`}
                          loading="lazy"
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      ) : (
                        <video
                          src={`${src}#t=0.2`}
                          muted
                          playsInline
                          preload="metadata"
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      )
                    ) : (
                      <div className="absolute inset-0 animate-pulse bg-zinc-800" />
                    )}
                    <div className="relative z-10 bg-gradient-to-t from-black/90 via-black/45 to-transparent p-2.5">
                      <p className="truncate text-xs font-bold text-white">@{video.username}</p>
                      {video.caption && (
                        <p className="line-clamp-2 text-[11px] text-white/75">{video.caption}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {hasMore && !loading && (
            <div className="mt-3 flex justify-center">
              <Button
                type="button"
                variant="outline"
                disabled={loadingMore}
                onClick={() => void loadPage(items.length, true)}
                className="rounded-full border-white/20 bg-zinc-900 text-white hover:bg-zinc-800"
              >
                {loadingMore ? "Loading..." : "Load 10 more"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
