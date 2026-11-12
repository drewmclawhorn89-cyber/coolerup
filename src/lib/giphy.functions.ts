import { createServerFn } from "@tanstack/react-start";

/**
 * Server-side Giphy proxy.
 *
 * The key used to be handed to the browser (`getGiphyKey`) and also inlined into
 * the bundle through `VITE_GIPHY_API_KEY`. That is what a security scanner flags
 * as a leaked credential: any visitor could read the key out of the JS bundle or
 * call the endpoint and lift it.
 *
 * Now the key never leaves the server. The browser asks this function for GIFs
 * and only ever receives URLs.
 *
 * The key is read per request, so setting `GIPHY_API_KEY` on the host is enough
 * and no rebuild is needed. `VITE_GIPHY_API_KEY` is still accepted as a fallback
 * for deployments that only have the old variable configured.
 */

export type GiphyGif = { id: string; url: string; preview: string };

export type GiphyResponse =
  | { ok: true; gifs: GiphyGif[] }
  | { ok: false; reason: "missing-key" | "bad-key" | "network"; detail?: string | undefined };

type GiphyImage = { url?: string };
type GiphyResult = {
  id?: string;
  images?: {
    fixed_height?: GiphyImage;
    fixed_height_small?: GiphyImage;
  };
};

const MAX_QUERY = 80;
const MAX_LIMIT = 50;

export const searchGiphy = createServerFn({ method: "GET" })
  .inputValidator((d: { q?: string; limit?: number } | undefined) => {
    const q = typeof d?.q === "string" ? d.q.trim().slice(0, MAX_QUERY) : "";
    const raw = Number(d?.limit ?? 24);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), MAX_LIMIT) : 24;
    return { q, limit };
  })
  .handler(async ({ data }): Promise<GiphyResponse> => {
    const key = (process.env["GIPHY_API_KEY"] ?? process.env["VITE_GIPHY_API_KEY"] ?? "").trim();
    if (!key) return { ok: false, reason: "missing-key" };

    const base = data.q ? "search" : "trending";
    const params = new URLSearchParams({
      api_key: key,
      limit: String(data.limit),
      rating: "pg-13",
    });
    if (data.q) params.set("q", data.q);

    try {
      const res = await fetch(`https://api.giphy.com/v1/gifs/${base}?${params.toString()}`);
      const json = (await res.json().catch(() => ({}))) as {
        data?: GiphyResult[];
        meta?: { status?: number; msg?: string };
      };

      if (!res.ok) {
        // 401/403 means the key itself is wrong, banned, or out of quota.
        const badKey = res.status === 401 || res.status === 403;
        return {
          ok: false,
          reason: badKey ? "bad-key" : "network",
          detail: json.meta?.msg ?? `HTTP ${res.status}`,
        };
      }

      // A GIF without a fixed_height rendition can't be shown, so skip it rather
      // than rendering a broken <img>.
      const gifs = (json.data ?? []).flatMap((g) => {
        const url = g.images?.fixed_height?.url;
        if (!g.id || !url) return [];
        return [{ id: g.id, url, preview: g.images?.fixed_height_small?.url ?? url }];
      });

      return { ok: true, gifs };
    } catch (err) {
      return {
        ok: false,
        reason: "network",
        detail: err instanceof Error ? err.message : undefined,
      };
    }
  });
