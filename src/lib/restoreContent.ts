import { supabase } from "@/integrations/supabase/client";

/**
 * Puts back everything moderation took down — hidden videos, soft-deleted
 * comments and messages, banned/muted/warned accounts, and rows that were
 * hard-deleted through Admin > Reports (those are archived before deletion).
 *
 * There is deliberately no button and no page for this: it runs once when the
 * app shell mounts. The database function is idempotent, so a second call in
 * the same session does nothing.
 */
const SESSION_KEY = "coolerup:restored-taken-down:v1";

let inFlight: Promise<void> | null = null;

export async function restoreTakenDownContent(): Promise<void> {
  if (typeof window === "undefined") return;

  // Once per browser session. The migration already ran a full restore, so
  // this is only picking up anything taken down since the last load.
  try {
    if (window.sessionStorage.getItem(SESSION_KEY)) return;
    window.sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* private mode — still run once per page load */
  }

  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const { data, error } = await supabase.rpc(
        "restore_all_taken_down_content" as never,
        {} as never,
      );
      if (error) {
        // Not fatal: the app works fine, content just stays as it was.
        console.warn("[restore] could not restore taken-down content:", error.message);
        return;
      }
      const row = (data ?? {}) as Record<string, unknown>;
      const total =
        Number(row["videos_restored"] ?? 0) +
        Number(row["comments_restored"] ?? 0) +
        Number(row["messages_restored"] ?? 0) +
        Number(row["users_restored"] ?? 0) +
        Number(row["archived_rows_restored"] ?? 0);
      if (total > 0) {
        console.info("[restore] restored taken-down content:", row);
      }
    } catch (err) {
      console.warn("[restore] restore call failed:", err);
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
