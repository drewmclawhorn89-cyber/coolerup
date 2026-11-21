/**
 * Pexels video API client.
 *
 * Pexels licenses its library for free commercial use and rehosting, which is
 * why this is the source the ingestion job pulls from: the files can legally
 * live in our own bucket. Attribution ("Video by <author> on Pexels") is
 * carried in the caption and in `source_author`.
 *
 * Everything here is defensive, because this runs unattended every 15 minutes:
 *   - a token bucket keeps us inside the published rate limit
 *   - 429/5xx/network failures retry with exponential backoff and jitter
 *   - `Retry-After` is honoured when Pexels sends it
 *   - every request has a hard timeout so a hung socket cannot wedge a run
 *
 * Docs: https://www.pexels.com/api/documentation/#videos
 */

const API_ROOT = "https://api.pexels.com";
const REQUEST_TIMEOUT_MS = 15_000;

export type PexelsVideoFile = {
  id: number;
  quality: "hd" | "sd" | "hls" | string;
  file_type: string;
  width: number;
  height: number;
  link: string;
};

export type PexelsVideo = {
  id: number;
  width: number;
  height: number;
  url: string;
  image: string;
  duration: number;
  user: { id: number; name: string; url: string };
  video_files: PexelsVideoFile[];
};

export type PexelsPage = {
  page: number;
  per_page: number;
  total_results: number;
  videos: PexelsVideo[];
};

/** Reasons a caller can act on, mirroring the TikTok engine's vocabulary. */
export type PexelsFailureReason =
  | "no_api_key"
  | "rate_limited"
  | "unauthorized"
  | "upstream_error"
  | "network_error"
  | "bad_response";

export class PexelsError extends Error {
  constructor(
    readonly reason: PexelsFailureReason,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "PexelsError";
  }
}

// ---------------------------------------------------------------------------
// Token bucket
// ---------------------------------------------------------------------------
//
// Pexels' default allowance is 200 requests/hour. The bucket is per-process,
// which is enough here: a single worker owns the cron slot (the database
// advisory lock guarantees that), so there is no second process competing.

type Bucket = { tokens: number; lastRefill: number };

const DEFAULT_CAPACITY = 180; // headroom under 200/hour
const REFILL_PER_MS = DEFAULT_CAPACITY / (60 * 60 * 1000);

let bucket: Bucket = { tokens: DEFAULT_CAPACITY, lastRefill: Date.now() };

function refill(now: number): void {
  const elapsed = now - bucket.lastRefill;
  if (elapsed <= 0) return;
  bucket.tokens = Math.min(DEFAULT_CAPACITY, bucket.tokens + elapsed * REFILL_PER_MS);
  bucket.lastRefill = now;
}

/** Wait until a token is available, then spend it. */
async function takeToken(): Promise<void> {
  for (;;) {
    const now = Date.now();
    refill(now);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return;
    }
    const deficit = 1 - bucket.tokens;
    const waitMs = Math.ceil(deficit / REFILL_PER_MS);
    await sleep(Math.min(waitMs, 5_000));
  }
}

/** Test seam: reset the bucket between cases. */
export function __resetRateLimiter(): void {
  bucket = { tokens: DEFAULT_CAPACITY, lastRefill: Date.now() };
}

export function __setRateLimitForTest(capacity: number): void {
  bucket = { tokens: capacity, lastRefill: Date.now() };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with full jitter, capped. */
export function backoffDelay(attempt: number, baseMs = 500, capMs = 20_000): number {
  const ceiling = Math.min(capMs, baseMs * 2 ** attempt);
  return Math.floor(Math.random() * ceiling);
}

function apiKey(): string {
  const key = process.env["PEXELS_API_KEY"]?.trim();
  if (!key) {
    throw new PexelsError("no_api_key", "PEXELS_API_KEY is not set on the server.");
  }
  return key;
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(header);
  if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  return null;
}

// ---------------------------------------------------------------------------
// Request with retry
// ---------------------------------------------------------------------------

export type RequestOptions = {
  /** Total attempts, including the first. */
  attempts?: number;
  /** Called after each failed attempt, for logging. */
  onRetry?: (attempt: number, error: PexelsError, delayMs: number) => void;
};

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 4;
  const key = apiKey();
  let lastError: PexelsError | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await takeToken();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${API_ROOT}${path}`, {
        headers: { Authorization: key, Accept: "application/json" },
        signal: controller.signal,
      });

      if (response.ok) {
        try {
          return (await response.json()) as T;
        } catch {
          throw new PexelsError("bad_response", "Pexels returned a body that was not JSON.");
        }
      }

      if (response.status === 429) {
        lastError = new PexelsError("rate_limited", "Pexels rate limit hit.", 429);
        const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
        const delay = retryAfter ?? backoffDelay(attempt);
        options.onRetry?.(attempt + 1, lastError, delay);
        await sleep(delay);
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        // A bad key will not fix itself; do not burn retries on it.
        throw new PexelsError("unauthorized", "Pexels rejected the API key.", response.status);
      }

      if (response.status >= 500) {
        lastError = new PexelsError("upstream_error", `Pexels returned ${response.status}.`, response.status);
        const delay = backoffDelay(attempt);
        options.onRetry?.(attempt + 1, lastError, delay);
        await sleep(delay);
        continue;
      }

      // 4xx that is not auth or rate limiting: retrying will not help.
      throw new PexelsError("bad_response", `Pexels returned ${response.status}.`, response.status);
    } catch (err) {
      if (err instanceof PexelsError) {
        if (err.reason === "unauthorized" || err.reason === "bad_response" || err.reason === "no_api_key") {
          throw err;
        }
        lastError = err;
      } else {
        const aborted = err instanceof Error && err.name === "AbortError";
        lastError = new PexelsError(
          "network_error",
          aborted ? "Pexels request timed out." : `Pexels request failed: ${(err as Error).message}`,
        );
      }
      const delay = backoffDelay(attempt);
      options.onRetry?.(attempt + 1, lastError, delay);
      await sleep(delay);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new PexelsError("network_error", "Pexels request failed after retries.");
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/** Trending / curated videos. */
export function fetchPopular(page = 1, perPage = 15, options?: RequestOptions): Promise<PexelsPage> {
  return requestJson<PexelsPage>(
    `/videos/popular?page=${page}&per_page=${clampPerPage(perPage)}&min_width=720`,
    options,
  );
}

/** Keyword search. */
export function searchVideos(
  query: string,
  page = 1,
  perPage = 15,
  options?: RequestOptions,
): Promise<PexelsPage> {
  const q = encodeURIComponent(query.trim());
  return requestJson<PexelsPage>(
    `/videos/search?query=${q}&page=${page}&per_page=${clampPerPage(perPage)}&min_width=720`,
    options,
  );
}

function clampPerPage(n: number): number {
  return Math.max(1, Math.min(80, Math.floor(n)));
}

// ---------------------------------------------------------------------------
// File selection
// ---------------------------------------------------------------------------

const MAX_FILE_BYTES = 120 * 1024 * 1024;

/**
 * Pick the best MP4 rendition for a short-form vertical feed.
 *
 * Preference order:
 *   1. an MP4 (never HLS — we need a file we can store)
 *   2. portrait-ish or square (the feed is vertical; landscape still plays)
 *   3. the largest rendition under the size ceiling
 *
 * Returns null when the asset has no usable MP4, which is a skip, not an error.
 */
export function pickBestMp4(video: PexelsVideo): PexelsVideoFile | null {
  const mp4s = (video.video_files ?? []).filter(
    (f) => f.file_type === "video/mp4" && typeof f.link === "string" && f.link.startsWith("http"),
  );
  if (mp4s.length === 0) return null;

  const score = (f: PexelsVideoFile): number => {
    const aspect = f.height > 0 ? f.width / f.height : 1;
    const verticalBonus = aspect <= 1.05 ? 1_000_000 : 0;
    const pixels = Math.min(f.width * f.height, MAX_FILE_BYTES);
    return verticalBonus + pixels;
  };

  return [...mp4s].sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** A stable, human-readable credit line. */
export function creditLine(video: PexelsVideo): string {
  const name = video.user?.name?.trim() || "a Pexels creator";
  return `Video by ${name} on Pexels`;
}
