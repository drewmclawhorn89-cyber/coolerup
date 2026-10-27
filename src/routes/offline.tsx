import { parseCaption } from "@/lib/loop";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, Eye, Lock, Trash2, ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatBytes, getSaved, listSaved, onOfflineChange, removeOffline } from "@/lib/offline";
import { useAuth } from "@/hooks/useAuth";
import { hasOfflineAccess, offlinePlan } from "@/lib/subscriptions";
import { toast } from "sonner";

export const Route = createFileRoute("/offline")({
  head: () => ({
    meta: [{ title: "Offline videos — Coolerup" }],
  }),
  component: OfflinePage,
});

function OfflinePage() {
  const auth = useAuth();
  const unlocked = hasOfflineAccess(auth.handle);
  const [items, setItems] = useState<{ id: string; video: any; size: number }[] | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const saved = await listSaved();
        if (!mounted) return;
        setItems(saved.map((s) => ({ id: s.id, video: s.video, size: s.size })));
      } catch (e) {
        console.error(e);
        if (!mounted) return;
        setItems([]);
      }
    };

    refresh();
    const off = onOfflineChange(refresh);
    return () => {
      mounted = false;
      off();
    };
  }, []);

  const handleView = async (id: string) => {
    try {
      const saved = await getSaved(id);
      if (!saved?.blob) {
        toast.error("Couldn't find saved video");
        return;
      }
      const url = URL.createObjectURL(saved.blob);
      window.open(url, "_blank", "noopener");
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
      URL.revokeObjectURL(url);
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

  // Offline mode is a Plus ($4.99) perk. Show the paywall instead of the library
  // so a lapsed subscriber cannot keep watching downloads for free.
  if (!unlocked) {
    return (
      <div className="mx-auto max-w-xl px-4 pb-10 pt-6 space-y-6">
        <div className="flex items-center gap-3">
          <Link to="/settings" aria-label="Back to settings" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="font-display text-2xl">Offline videos</h1>
        </div>

        <div className="rounded-2xl border bg-card p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Lock className="h-6 w-6 text-muted-foreground" />
          </div>
          <h2 className="mt-3 font-semibold">Offline mode is a Plus feature</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Subscribe to save videos and watch them without a connection. Offline downloads start
            at ${offlinePlan().price.toFixed(2)}/mo and are included in every paid plan.
          </p>
          <Link
            to="/"
            search={{ tab: "subscriptions" }}
            className="mt-4 inline-flex rounded-md bg-black px-4 py-2 font-medium text-white"
          >
            Get Plus — ${offlinePlan().price.toFixed(2)}/mo
          </Link>
          <p className="mt-3 text-xs text-muted-foreground">
            {auth.handle
              ? "Already subscribed? Offline mode unlocks as soon as your plan is active."
              : "Sign in first so we can check your plan."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 pb-10 pt-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/settings" aria-label="Back to settings" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-display text-2xl">Offline videos</h1>
      </div>

      <div className="rounded-2xl border bg-card p-4">
        {!items ? (
          <div className="text-sm text-muted-foreground">Loading saved videos…</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-muted-foreground">No saved videos</div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="h-12 w-16 overflow-hidden rounded bg-zinc-800">
                    {item.video?.poster_url ? (
                      <img src={item.video.poster_url} alt="" className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{parseCaption(item.video?.caption ?? "").text || `@${item.video?.username}`}</div>
                    <div className="text-xs text-muted-foreground">{formatBytes(item.size)}</div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => handleView(item.id)}>
                    <Eye className="mr-1 h-4 w-4" />
                    View
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleDownload(item.id)}>
                    <Download className="mr-1 h-4 w-4" />
                    Download
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => handleRemove(item.id)} disabled={removingId === item.id}>
                    <Trash2 className="mr-1 h-4 w-4" />
                    {removingId === item.id ? "Removing..." : "Remove"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
