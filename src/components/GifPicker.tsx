import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { getGiphyKey } from "@/lib/giphy.functions";

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

/**
 * Giphy search/trending picker. Shared by feed comments, full-video comments
 * and LIVE chat so every place you can post a message can post a GIF too.
 *
 * The key is resolved in two steps: the build-time `VITE_GIPHY_API_KEY` if the
 * bundle was built with one, otherwise `getGiphyKey()` asks the server at
 * request time. The second path means setting `GIPHY_API_KEY` on the host and
 * restarting is enough — no rebuild. Giphy's retired public beta key is never
 * used as a fallback; it returns 403 BANNED and only produced a vague
 * "Couldn't load GIFs" toast.
 */
export function GifPicker({
  onPick,
  onClose,
  className = "",
}: {
  onPick: (url: string) => void;
  onClose: () => void;
  className?: string;
}) {
  const [q, setQ] = useState("");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

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

  return (
    <div className={`border-t p-3 ${className}`}>
      <div className="mb-2 flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search GIFs…"
          disabled={!resolved || !key}
          className="min-w-0 flex-1 rounded-full bg-secondary px-4 py-2 text-base outline-none disabled:opacity-50 sm:text-sm"
        />
        <button type="button" onClick={onClose} aria-label="Close GIF picker">
          <X className="h-4 w-4" />
        </button>
      </div>

      {failure && (
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

      <div className="grid max-h-40 grid-cols-3 gap-1 overflow-y-auto">
        {!resolved && <p className="col-span-3 text-xs text-muted-foreground">Loading…</p>}
        {resolved && loading && <p className="col-span-3 text-xs text-muted-foreground">Loading…</p>}
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
    </div>
  );
}
