import { parseCaption } from "@/lib/loop";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, Eye, Trash2, ArrowLeft, Play, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  formatBytes,
  getSaved,
  listSaved,
  listSavedFullVideos,
  onOfflineChange,
  removeOffline,
  removeFullVideoOffline,
  type SavedFullVideo,
} from "@/lib/offline";
import { toast } from "sonner";

export const Route = createFileRoute("/offline")({
  head: () => ({ meta: [{ title: "Offline videos — Coolerup" }] }),
  component: OfflinePage,
});

type FeedItem = { id: string; video: any; size: number };

function OfflinePage() {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [fullItems, setFullItems] = useState<SavedFullVideo[] | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [playing, setPlaying] = useState<{ url: string; title: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const [saved, savedFull] = await Promise.all([listSaved(), listSavedFullVideos()]);
        if (!mounted) return;
        setItems(saved.map((s) => ({ id: s.id, video: s.video, size: s.size })));
        setFullItems(savedFull);
      } catch (e) {
        console.error(e);
        if (!mounted) return;
        setItems([]);
        setFullItems([]);
      }
    };
    void refresh();
    const off = onOfflineChange(refresh);
    return () => {
      mounted = false;
      off();
    };
  }, []);

  useEffect(
    () => () => {
      if (playing?.url) URL.revokeObjectURL(playing.url);
    },
    [playing?.url],
  );

  const handleView = async (id: string) => {
    try {
      const saved = await getSaved(id);
      if (!saved?.blob) {
        toast.error("Couldn't find saved video");
        return;
      }
      const url = URL.createObjectURL(saved.blob);
      window.open(url, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      console.error(e);
      toast.error("Couldn't open saved video");
    }
  };

  const handleDownload = async (id: string) => {
    try {
      const saved = await getSaved(id);
      if (!saved?.blob) {
        toast.error("Couldn't find saved video");
        return;
      }
      const url = URL.createObjectURL(saved.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `coolerup-${id}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success("Download started");
    } catch (e) {
      console.error(e);
      toast.error("Couldn't download saved video");
    }
  };

  const handleRemove = async (id: string) => {
    setRemovingId(id);
    try {
      await removeOffline(id);
      setItems((cur) => (cur ?? []).filter((item) => item.id !== id));
      toast.success("Removed from offline");
    } catch (e) {
      console.error(e);
      toast.error("Couldn't remove saved video");
    } finally {
      setRemovingId(null);
    }
  };

  const handleFullView = async (item: SavedFullVideo) => {
    try {
      const url = URL.createObjectURL(item.blob);
      setPlaying({ url, title: item.video.title });
    } catch (e) {
      console.error(e);
      toast.error("Couldn't open saved video");
    }
  };

  const handleFullDownload = async (item: SavedFullVideo) => {
    try {
      const url = URL.createObjectURL(item.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `coolerup-${item.id}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success("Download started");
    } catch (e) {
      console.error(e);
      toast.error("Couldn't download saved video");
    }
  };

  const handleFullRemove = async (id: string) => {
    setRemovingId(id);
    try {
      await removeFullVideoOffline(id);
      setFullItems((cur) => (cur ?? []).filter((item) => item.id !== id));
      toast.success("Removed from offline");
    } catch (e) {
      console.error(e);
      toast.error("Couldn't remove saved video");
    } finally {
      setRemovingId(null);
    }
  };

  const isEmpty = items?.length === 0 && fullItems?.length === 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 pb-10 pt-6">
      <div className="flex items-center gap-3">
        <Link
          to="/settings"
          aria-label="Back to settings"
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-display text-2xl">Offline videos</h1>
      </div>

      {playing && (
        <div className="rounded-2xl border bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="truncate font-semibold">{playing.title}</h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPlaying(null)}
              aria-label="Close offline player"
            >
              <X className="mr-1 h-4 w-4" /> Close
            </Button>
          </div>
          <video
            src={playing.url}
            controls
            autoPlay
            playsInline
            className="max-h-[70vh] w-full rounded-xl bg-black"
          />
        </div>
      )}

      <section className="space-y-3">
        <h2 className="font-semibold">Short videos</h2>
        <div className="rounded-2xl border bg-card p-4">
          {!items || !fullItems ? (
            <div className="text-sm text-muted-foreground">Loading saved videos…</div>
          ) : items.length === 0 ? (
            <div className="text-sm text-muted-foreground">No saved short videos</div>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="h-12 w-16 overflow-hidden rounded bg-zinc-800">
                      {item.video?.poster_url ? (
                        <img
                          src={item.video.poster_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {parseCaption(item.video?.caption ?? "").text || `@${item.video?.username}`}
                      </div>
                      <div className="text-xs text-muted-foreground">{formatBytes(item.size)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => void handleView(item.id)}>
                      <Eye className="mr-1 h-4 w-4" />
                      View
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleDownload(item.id)}
                    >
                      <Download className="mr-1 h-4 w-4" />
                      Download
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => void handleRemove(item.id)}
                      disabled={removingId === item.id}
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      {removingId === item.id ? "Removing…" : "Remove"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Full-length videos</h2>
        <div className="rounded-2xl border bg-card p-4">
          {!fullItems || !items ? (
            <div className="text-sm text-muted-foreground">Loading saved videos…</div>
          ) : fullItems.length === 0 ? (
            <div className="text-sm text-muted-foreground">No saved full-length videos</div>
          ) : (
            <div className="space-y-3">
              {fullItems.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="h-12 w-16 shrink-0 overflow-hidden rounded bg-zinc-800">
                      {item.video.thumbnail_url ? (
                        <img
                          src={item.video.thumbnail_url}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Play className="m-auto h-5 w-5" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{item.video.title}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        @{item.video.username} · {formatBytes(item.size)}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => void handleFullView(item)}>
                      <Eye className="mr-1 h-4 w-4" />
                      View
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleFullDownload(item)}
                    >
                      <Download className="mr-1 h-4 w-4" />
                      Download
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => void handleFullRemove(item.id)}
                      disabled={removingId === item.id}
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      {removingId === item.id ? "Removing…" : "Remove"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
      {isEmpty && (
        <p className="text-center text-sm text-muted-foreground">
          No saved videos yet. Save videos from the feed or Videos tab.
        </p>
      )}
    </div>
  );
}
