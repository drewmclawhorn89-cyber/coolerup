/**
 * Turn whatever Supabase / fetch threw into something a person can act on.
 *
 * The post dialogs used to show a single "Upload failed. Try again." for every
 * possible cause — a 500 MB file hitting the bucket cap, a missing storage
 * policy, an expired session, a dropped connection. That message told the user
 * nothing, so they retried the same doomed upload forever. This module keeps
 * the friendly tone but names the actual problem.
 *
 * Keep it free of React and of the Supabase client so it stays trivially
 * testable.
 */

export type UploadErrorKind =
  | "too-large"
  | "wrong-type"
  | "not-signed-in"
  | "forbidden"
  | "not-configured"
  | "offline"
  | "rate-limited"
  | "server"
  | "unknown";

/** Pull a readable string out of anything thrown. */
export function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) {
    const extra = error as Error & { status?: number; statusCode?: number; code?: string };
    const parts = [error.message, extra.code, extra.status, extra.statusCode]
      .filter((part) => part !== undefined && part !== null && part !== "")
      .map(String);
    return parts.join(" ");
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts = ["message", "error", "error_description", "code", "status", "statusCode"]
      .map((key) => record[key])
      .filter((part) => part !== undefined && part !== null && part !== "")
      .map(String);
    if (parts.length) return parts.join(" ");
  }
  return "";
}

const MATCHERS: { kind: UploadErrorKind; test: RegExp }[] = [
  {
    kind: "too-large",
    test: /payload too large|entity too large|exceeded the maximum allowed size|file size|too large|413|maximum size|size limit/i,
  },
  {
    kind: "wrong-type",
    test: /mime|content type|content-type|unsupported file|invalid file type|415/i,
  },
  {
    kind: "not-signed-in",
    test: /jwt|not authenticated|no session|session.*expired|refresh token|401|unauthorized/i,
  },
  {
    kind: "forbidden",
    test: /row-level security|row level security|permission denied|not allowed|policy|403/i,
  },
  {
    kind: "not-configured",
    test: /bucket not found|no such bucket|does not exist|relation .* does not exist|undefined table|404/i,
  },
  {
    kind: "offline",
    test: /failed to fetch|networkerror|network error|load failed|connection|offline|timeout|timed out|aborted/i,
  },
  { kind: "rate-limited", test: /rate limit|too many requests|429/i },
  { kind: "server", test: /internal server|bad gateway|service unavailable|5\d\d/i },
];

export function classifyUploadError(error: unknown): UploadErrorKind {
  const text = errorText(error);
  if (!text) return "unknown";
  for (const matcher of MATCHERS) {
    if (matcher.test.test(text)) return matcher.kind;
  }
  return "unknown";
}

const MESSAGES: Record<UploadErrorKind, string> = {
  "too-large": "That file is too big to upload. Trim it down or pick a shorter clip.",
  "wrong-type": "Coolerup can't read that file type. Try an MP4, MOV or JPG.",
  "not-signed-in": "Your session expired. Sign in again, then post.",
  forbidden: "You don't have permission to post right now. Sign in again and retry.",
  "not-configured": "Uploads aren't set up on this build yet. Try again in a minute.",
  offline: "The connection dropped mid-upload. Check your signal and try again.",
  "rate-limited": "You're posting too fast. Wait a few seconds and try again.",
  server: "Coolerup's servers hiccuped. Try again in a moment.",
  unknown: "Upload failed. Try again.",
};

/** Friendly, specific message for a failed upload. */
export function describeUploadError(error: unknown): string {
  return MESSAGES[classifyUploadError(error)];
}

/** Failures that are worth retrying automatically. */
export function isRetryableUploadError(error: unknown): boolean {
  const kind = classifyUploadError(error);
  return kind === "offline" || kind === "server";
}

/**
 * Run an upload, retrying transient network/server failures a couple of times
 * with a short backoff. Permanent failures (too large, forbidden, signed out)
 * are thrown straight back so the caller can explain them immediately.
 */
export async function withUploadRetry<T>(
  run: () => Promise<T>,
  attempts = 3,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  const total = Math.max(1, attempts);
  let lastError: unknown;
  for (let attempt = 1; attempt <= total; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (attempt === total || !isRetryableUploadError(error)) throw error;
      await wait(attempt * 700);
    }
  }
  throw lastError;
}
