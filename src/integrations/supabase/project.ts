/**
 * Supabase project defaults.
 *
 * The project URL is public information (it is embedded in every browser
 * request), but a deploy can still be built without `VITE_SUPABASE_URL`. When
 * that happened on coolerup.lovable.app the client silently fell back to the
 * offline mock: sign-in always failed and the feed always rendered empty, even
 * though the publishable key *was* present and the database was healthy.
 *
 * The publishable key is the credential that must never be invented, so we only
 * derive the URL from the public project ref. If the key is missing the client
 * still uses the mock (which is what the test suite relies on).
 */
export const SUPABASE_PROJECT_ID = "ojpwnulpmqfmjwqaplwe";

export const DEFAULT_SUPABASE_URL = `https://${SUPABASE_PROJECT_ID}.supabase.co`;

/** Use an explicit URL when provided, otherwise the known public project URL. */
export function resolveSupabaseUrl(explicit?: string | null): string {
  const trimmed = explicit?.trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_SUPABASE_URL;
}
