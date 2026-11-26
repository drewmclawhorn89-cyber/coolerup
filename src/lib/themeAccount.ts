import { supabase } from "@/integrations/supabase/client";
import { applyTheme, isSupportedTheme, writePref } from "@/lib/prefs";

export const THEME_CHANGED_EVENT = "coolerup-theme-changed";

const untypedDb = supabase as unknown as {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => {
        maybeSingle: () => Promise<{
          data: Record<string, unknown> | null;
          error: { message?: string; code?: string } | null;
        }>;
      };
    };
    update: (values: Record<string, unknown>) => {
      eq: (
        col: string,
        val: string,
      ) => Promise<{ error: { message?: string; code?: string } | null }>;
    };
  };
};

export function normalizeThemeId(raw: unknown): string {
  if (typeof raw !== "string") return "dark";
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned || !isSupportedTheme(cleaned)) return "dark";
  return cleaned;
}

function isMissingColumnError(
  error: { message?: string; code?: string } | null | undefined,
): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const msg = String(error.message ?? "").toLowerCase();
  return (
    code === "42703" ||
    code === "PGRST204" ||
    msg.includes("column") ||
    msg.includes("schema cache")
  );
}

function emitThemeChanged(theme: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT, { detail: { theme } }));
}

/**
 * Load the signed-in user's theme from their Supabase account (keyed by `user_id`)
 * and apply it immediately across the app.
 */
export async function loadAccountTheme(userId: string | null | undefined): Promise<string> {
  if (!userId) {
    applyTheme("dark");
    writePref("theme", "dark");
    emitThemeChanged("dark");
    return "dark";
  }

  let found: string | null = null;
  try {
    const { data, error } = await untypedDb
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (!error && data && typeof data["theme"] === "string" && isSupportedTheme(data["theme"])) {
      found = normalizeThemeId(data["theme"]);
    }
  } catch {
    /* ignore profile query errors and check auth metadata */
  }

  if (!found) {
    try {
      const { data } = await supabase.auth.getUser();
      const metaTheme = data.user?.id === userId ? data.user.user_metadata?.["theme"] : undefined;
      if (typeof metaTheme === "string" && isSupportedTheme(metaTheme)) {
        found = normalizeThemeId(metaTheme);
      }
    } catch {
      /* ignore auth metadata fallback errors */
    }
  }

  const next = found ?? "dark";
  applyTheme(next);
  writePref("theme", next);
  emitThemeChanged(next);
  return next;
}

/**
 * Apply a theme immediately in the DOM (no reload) and persist it to the
 * signed-in user's account by `user_id` so it syncs across devices.
 */
export async function saveAccountTheme(
  userId: string | null | undefined,
  themeId: string,
): Promise<{ ok: boolean; theme: string; error?: string }> {
  const next = normalizeThemeId(themeId);
  applyTheme(next);
  writePref("theme", next);
  emitThemeChanged(next);

  if (!userId) return { ok: true, theme: next };

  let profileError: { message?: string; code?: string } | null = null;
  try {
    const res = await untypedDb.from("profiles").update({ theme: next }).eq("id", userId);
    profileError = res.error;
  } catch {
    profileError = null;
  }

  let authError: { message?: string } | null = null;
  try {
    const res = await supabase.auth.updateUser({ data: { theme: next } });
    authError = res.error;
  } catch {
    authError = null;
  }

  if (profileError && !isMissingColumnError(profileError) && authError) {
    return {
      ok: false,
      theme: next,
      error: profileError.message ?? authError.message ?? "Couldn't save theme",
    };
  }

  return { ok: true, theme: next };
}
