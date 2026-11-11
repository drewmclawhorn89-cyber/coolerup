import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";

// Bracket access: `import.meta.env` is typed with an index signature, so
// `env.VITE_GIPHY_API_KEY` fails `tsc --noEmit` (TS4111).
const GIPHY_KEY = (import.meta.env["VITE_GIPHY_API_KEY"] as string | undefined) ?? "dc6zaTOxFJmzC";

type Gif = { id: string; url: string; preview: string };

type GiphyImage = { url?: string };
type GiphyResult = {
  id?: string;
  images?: {
    fixed_height?: GiphyImage;
    fixed_height_small?: GiphyImage;
  };
};

/**
 * Giphy search/trending picker. Shared by feed comments, full-video comments
 * and LIVE chat so every place you can post a message can post a GIF too.
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

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const base = q.trim() ? "search" : "trending";
        const params = new URLSearchParams({ api_key: GIPHY_KEY, limit: "24", rating: "pg-13" });
        if (q.trim()) params.set("q", q.trim());
        const res = await fetch(`https://api.giphy.com/v1/gifs/${base}?${params}`);
        if (!res.ok) throw new Error(`Giphy responded ${res.status}`);
        const json = (await res.json()) as { data?: GiphyResult[] };
        // A GIF without a fixed_height rendition can't be shown, so skip it
        // rather than rendering a broken <img>.
        setGifs(
          (json.data ?? []).flatMap((g) => {
            const url = g.images?.fixed_height?.url;
            if (!g.id || !url) return [];
            return [{ id: g.id, url, preview: g.images?.fixed_height_small?.url ?? url }];
          }),
        );
      } catch {
        toast.error("Couldn't load GIFs");
      }
      setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className={`border-t p-3 ${className}`}>
      <div className="mb-2 flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search GIFs…"
          className="min-w-0 flex-1 rounded-full bg-secondary px-4 py-2 text-base outline-none sm:text-sm"
        />
        <button type="button" onClick={onClose} aria-label="Close GIF picker">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid max-h-40 grid-cols-3 gap-1 overflow-y-auto">
        {loading && <p className="col-span-3 text-xs text-muted-foreground">Loading…</p>}
        {!loading && gifs.length === 0 && (
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
