import { useCallback, useEffect, useState } from "react";
import { Flag, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { getGiphyKey } from "@/lib/giphy.functions";
import { useAuth } from "@/hooks/useAuth";
import { MakeGif } from "@/components/MakeGif";
import {
  bumpGifUse,
  deleteGif,
  listMyGifs,
  listTrendingGifs,
  reportGif,
  searchGifs,
  type GifPickMeta,
  type GifRow,
} from "@/lib/gif";

// Bracket access: `import.meta.env` is typed with an index signature, so
// `env.VITE_GIPHY_API_KEY` fails `tsc --noEmit` (TS4111).
const BUILD_KEY = ((import.meta.env["VITE_GIPHY_API_KEY"] as string | undefined) ?? "").trim();

type Gif = { id: string; url: string; preview: string };

type GiphyImage = { url?: string };
type GiphyResult = {
  id?: string;
  images?: {
    fixed_height?: GiphyImage;
    fixed_height_small?: GiphyImage;
  };
};

type Failure = { kind: "missing-key" | "bad-key" | "network"; detail?: string | undefined };

type Tab = "trending" | "mine";

/**
 * GIF picker shared by feed comments, full-video comments, LIVE chat and DMs.
 *
 * Two sources live side by side:
 *  - Giphy (search + trending), exactly as before
 *  - Coolerup GIFs made by users ("Make Your Own GIFs")
 *
 * The search bar and the grid are the same UI the screenshot had; `+ Make GIF`
 * sits beside the search box, and the tabs switch between Trending and My GIFs.
 * Picking a user-made GIF also returns its author so the composer can show
 * "Made by @handle".
 */
export function GifPicker({
  onPick,
  onClose,
  className = "",
  fill = false,
}: {
  onPick: (url: string, meta?: GifPickMeta) => void;
  onClose: () => void;
  className?: string;
  /**
   * Stretch to the height of the parent instead of using a fixed max height.
   * Used inside the comments sheet, where the picker replaces the thread and
   * must not push its own buttons off the bottom of a phone screen.
   */
  fill?: boolean;
}) {
  const { user, signIn } = useAuth();
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("trending");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [mine, setMine] = useState<GifRow[]>([]);
  const [custom, setCustom] = useState<GifRow[]>([]);
  const [customLoading, setCustomLoading] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);
  const [showMaker, setShowMaker] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Empty until resolved. `resolved` separates "still asking the server" from
  // "the server says there is no key", so we never flash a config error.
  const [key, setKey] = useState(BUILD_KEY);
  const [resolved, setResolved] = useState(BUILD_KEY.length > 0);

  useEffect(() => {
    if (BUILD_KEY) return;
    let alive = true;
    void getGiphyKey()
      .then((res) => {
        if (!alive) return;
        setKey((res?.key ?? "").trim());
      })
      .catch(() => {
        // Server unreachable or the function isn't deployed; fall through to
        // the missing-key message rather than hanging on "Loading…".
        if (alive) setKey("");
      })
      .finally(() => {
        if (alive) setResolved(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!resolved) return;

    if (!key) {
      setGifs([]);
      setFailure({ kind: "missing-key" });
      return;
    }

    let alive = true;
    const t = setTimeout(async () => {
      setLoading(true);
      setFailure(null);
      try {
        const base = q.trim() ? "search" : "trending";
        const params = new URLSearchParams({ api_key: key, limit: "24", rating: "pg-13" });
        if (q.trim()) params.set("q", q.trim());
        const res = await fetch(`https://api.giphy.com/v1/gifs/${base}?${params}`);
        const json = (await res.json().catch(() => ({}))) as {
          data?: GiphyResult[];
          meta?: { status?: number; msg?: string };
        };
        if (!alive) return;

        if (!res.ok) {
          // 401/403 means the key itself is wrong, banned, or out of quota.
          // Anything else is treated as a transient network problem.
          const badKey = res.status === 401 || res.status === 403;
          setGifs([]);
          setFailure({
            kind: badKey ? "bad-key" : "network",
            detail: json.meta?.msg ?? `HTTP ${res.status}`,
          });
          return;
        }

        // A GIF without a fixed_height rendition can't be shown, so skip it
        // rather than rendering a broken <img>.
        setGifs(
          (json.data ?? []).flatMap((g) => {
            const url = g.images?.fixed_height?.url;
            if (!g.id || !url) return [];
            return [{ id: g.id, url, preview: g.images?.fixed_height_small?.url ?? url }];
          }),
        );
      } catch (err) {
        if (!alive) return;
        setGifs([]);
        setFailure({ kind: "network", detail: err instanceof Error ? err.message : undefined });
      } finally {
        if (alive) setLoading(false);
      }
    }, 300);

    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, key, resolved]);

  const loadCustom = useCallback(async () => {
    if (!user) {
      setMine([]);
      setCustom([]);
      return;
    }
    setCustomLoading(true);
    setCustomError(null);
    try {
      const [trending, own] = await Promise.all([
        q.trim() ? searchGifs(q, 24) : listTrendingGifs(24),
        listMyGifs(user.id),
      ]);
      setCustom(trending);
      setMine(own);
    } catch (err) {
      setCustom([]);
      setMine([]);
      setCustomError(err instanceof Error ? err.message : "Couldn't load Coolerup GIFs.");
    } finally {
      setCustomLoading(false);
    }
  }, [user, q]);

  useEffect(() => {
    if (showMaker) return;
    void loadCustom();
  }, [loadCustom, showMaker]);

  const pickCustom = (gif: GifRow) => {
    bumpGifUse(gif.id);
    onPick(gif.gif_url, {
      id: gif.id,
      title: gif.title,
      username: gif.username ?? null,
    });
  };

  const remove = async (gif: GifRow) => {
    if (!window.confirm("Delete this GIF? It will disappear from comments and LIVE chat.")) return;
    setBusyId(gif.id);
    try {
      await deleteGif(gif);
      setMine((rows) => rows.filter((r) => r.id !== gif.id));
      setCustom((rows) => rows.filter((r) => r.id !== gif.id));
      toast.success("GIF deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete that GIF.");
    } finally {
      setBusyId(null);
    }
  };

  const report = async (gif: GifRow) => {
    if (!user) {
      void signIn();
      return;
    }
    setBusyId(gif.id);
    try {
      await reportGif(gif.id, user.id);
      toast.success("Reported — thanks. We'll review this GIF.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't report that GIF.");
    } finally {
      setBusyId(null);
    }
  };

  if (showMaker) {
    return (
      <div className={`flex min-h-0 flex-col border-t p-0 ${fill ? "flex-1" : ""} ${className}`}>
        <MakeGif
          className="min-h-0 border-t-0 p-0"
          expand={fill}
          onCreated={() => {
            setShowMaker(false);
            setTab("mine");
            void loadCustom();
          }}
          onClose={() => setShowMaker(false)}
        />
      </div>
    );
  }

  const shownCustom = tab === "mine" ? mine : custom;
  const showGiphy = tab === "trending";

  return (
    <div className={`flex min-h-0 flex-col border-t p-3 ${fill ? "flex-1" : ""} ${className}`}>
      <div className="mb-2 flex shrink-0 items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search GIFs…"
          disabled={!resolved || !key}
          className="min-w-0 flex-1 rounded-full bg-secondary px-4 py-2 text-base outline-none disabled:opacity-50 sm:text-sm"
        />
        <button
          type="button"
          onClick={() => {
            if (!user) {
              void signIn();
              return;
            }
            setShowMaker(true);
          }}
          className="flex shrink-0 items-center gap-1 rounded-full bg-primary px-3 py-2 text-xs font-bold text-primary-foreground"
          aria-label="Make your own GIF"
        >
          <Plus className="h-3.5 w-3.5" /> Make GIF
        </button>
        <button type="button" onClick={onClose} aria-label="Close GIF picker">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-2 flex gap-1 rounded-full bg-secondary/60 p-0.5 text-xs font-bold">
        <button
          type="button"
          onClick={() => setTab("trending")}
          aria-pressed={tab === "trending"}
          className={`flex-1 rounded-full py-1.5 ${
            tab === "trending" ? "bg-background shadow-sm" : "text-muted-foreground"
          }`}
        >
          Trending
        </button>
        <button
          type="button"
          onClick={() => setTab("mine")}
          aria-pressed={tab === "mine"}
          className={`flex-1 rounded-full py-1.5 ${
            tab === "mine" ? "bg-background shadow-sm" : "text-muted-foreground"
          }`}
        >
          My GIFs{mine.length > 0 ? ` (${mine.length})` : ""}
        </button>
      </div>

      {failure && showGiphy && (
        <div className="mb-2 space-y-1 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {failure.kind === "missing-key" && (
            <>
              <p className="font-bold">GIF search isn't configured.</p>
              <p>
                Set <code className="font-mono">GIPHY_API_KEY</code> (or{" "}
                <code className="font-mono">VITE_GIPHY_API_KEY</code>) on the server — free key at{" "}
                <a
                  href="https://developers.giphy.com/dashboard/"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  developers.giphy.com
                </a>
                .
              </p>
              <p>
                <code className="font-mono">VITE_</code> keys are baked in at build time, so that
                route needs a rebuild; <code className="font-mono">GIPHY_API_KEY</code> is read per
                request and only needs a restart.
              </p>
            </>
          )}
          {failure.kind === "bad-key" && (
            <>
              <p className="font-bold">Giphy rejected the API key.</p>
              <p>
                The key is invalid, banned, or over its quota. Check{" "}
                <code className="font-mono">GIPHY_API_KEY</code>.
                {failure.detail ? ` (${failure.detail})` : ""}
              </p>
            </>
          )}
          {failure.kind === "network" && (
            <>
              <p className="font-bold">Couldn't reach Giphy.</p>
              <p>{failure.detail ?? "Check your connection and try again."}</p>
            </>
          )}
        </div>
      )}

      {customError && (
        <p className="mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {customError}
        </p>
      )}

      {tab === "mine" && !user && (
        <div className="mb-2 rounded-lg bg-secondary/60 p-3 text-center text-xs text-muted-foreground">
          Sign in to make and keep your own GIFs.
          <button
            type="button"
            onClick={() => void signIn()}
            className="ml-2 rounded-full bg-primary px-3 py-1 text-[11px] font-bold text-primary-foreground"
          >
            Sign in
          </button>
        </div>
      )}

      {shownCustom.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {tab === "mine" ? "Your GIFs" : "Made on Coolerup"}
          </p>
          <div
            className={
              fill
                ? "grid min-h-0 flex-1 grid-cols-3 gap-1 overflow-y-auto"
                : "grid max-h-40 grid-cols-3 gap-1 overflow-y-auto"
            }
          >
            {shownCustom.map((g) => {
              const isOwn = !!user && g.user_id === user.id;
              return (
                <div key={g.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => pickCustom(g)}
                    aria-label={`Pick ${g.title}`}
                    className="block w-full"
                  >
                    <img
                      src={g.gif_url}
                      alt={g.title}
                      loading="lazy"
                      className="h-20 w-full rounded object-cover"
                    />
                    <span className="absolute inset-x-0 bottom-0 truncate rounded-b bg-black/60 px-1 py-0.5 text-left text-[9px] font-semibold text-white">
                      {g.username ? `Made by @${g.username}` : g.title}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => (isOwn ? void remove(g) : void report(g))}
                    disabled={busyId === g.id}
                    aria-label={isOwn ? `Delete ${g.title}` : `Report ${g.title}`}
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100 disabled:opacity-50"
                  >
                    {busyId === g.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : isOwn ? (
                      <Trash2 className="h-3 w-3" />
                    ) : (
                      <Flag className="h-3 w-3" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "mine" && user && !customLoading && mine.length === 0 && (
        <p className="mb-2 rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
          No GIFs yet. Tap <strong>+ Make GIF</strong> to cut one from your videos.
        </p>
      )}

      {customLoading && (
        <p className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading Coolerup GIFs…
        </p>
      )}

      {showGiphy && (
        <div
          className={
            fill
              ? "grid min-h-0 flex-1 grid-cols-3 gap-1 overflow-y-auto"
              : "grid max-h-40 grid-cols-3 gap-1 overflow-y-auto"
          }
        >
          {!resolved && <p className="col-span-3 text-xs text-muted-foreground">Loading…</p>}
          {resolved && loading && (
            <p className="col-span-3 text-xs text-muted-foreground">Loading…</p>
          )}
          {resolved && !loading && !failure && gifs.length === 0 && (
            <p className="col-span-3 text-xs text-muted-foreground">No GIFs found.</p>
          )}
          {gifs.map((g) => (
            <button type="button" key={g.id} onClick={() => onPick(g.url)} aria-label="Pick GIF">
              <img
                src={g.preview}
                alt="GIF"
                loading="lazy"
                className="h-20 w-full rounded object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
