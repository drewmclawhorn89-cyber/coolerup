import { supabase } from "@/integrations/supabase/client";

/**
 * Media URL resolution.
 *
 * The "videos" storage bucket is PRIVATE, so `getPublicUrl()` returns links
 * that 404 ("Bucket not found"). Anything we render from that bucket has to be
 * a signed URL instead.
 *
 * Two shapes are supported:
 *   1. `storage:<path>`                   — what new uploads store (preferred)
 *   2. `.../object/public/videos/<path>`  — legacy public URLs already in the DB
 *
 * Anything else (http(s) links, data: URIs) is returned untouched.
 */
const STORAGE_PREFIX = "storage:";
const PUBLIC_MARKER = "/object/public/videos/";
const SIGNED_TTL_SECONDS = 60 * 60 * 6;

/** path -> { url, expiresAt } so we don't re-sign on every render. */
const cache = new Map<string, { url: string; expiresAt: number }>();

/** Pull the storage path out of a stored value, or null if it isn't ours. */
export function storagePathOf(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith(STORAGE_PREFIX)) return value.slice(STORAGE_PREFIX.length);
  const at = value.indexOf(PUBLIC_MARKER);
  if (at !== -1) {
    const raw = value.slice(at + PUBLIC_MARKER.length).split("?")[0]?.split("#")[0] ?? "";
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/** Sign a single storage path. Returns "" when the object can't be signed. */
export async function signStoragePath(path: string): Promise<string> {
  const hit = cache.get(path);
  if (hit && hit.expiresAt > Date.now()) return hit.url;

  const { data, error } = await supabase.storage
    .from("videos")
    .createSignedUrl(path, SIGNED_TTL_SECONDS);
  if (error || !data?.signedUrl) return "";

  cache.set(path, {
    url: data.signedUrl,
    expiresAt: Date.now() + (SIGNED_TTL_SECONDS - 60) * 1000,
  });
  return data.signedUrl;
}

/** Turn any stored media value into something the browser can actually load. */
export async function resolveMediaUrl(value: string | null | undefined): Promise<string> {
  if (!value) return "";
  const path = storagePathOf(value);
  if (!path) return value;
  const signed = await signStoragePath(path);
  return signed || "";
}

/** Resolve many values at once, preserving order. */
export async function resolveMediaUrls(values: (string | null | undefined)[]): Promise<string[]> {
  return Promise.all(values.map((v) => resolveMediaUrl(v)));
}
