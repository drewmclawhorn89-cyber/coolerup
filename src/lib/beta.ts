import { supabase } from "@/integrations/supabase/client";

/** True everywhere inside the /beta area. */
export const isBeta = true;

export const BETA_FLAGS = [
  { name: "new_gift_panel", label: "Try New Gift Panel" },
  { name: "new_search", label: "Try New Search" },
  { name: "shake_shuffle", label: "Try Shake Shuffle" },
] as const;

export type BetaFlagName = (typeof BETA_FLAGS)[number]["name"];

/** Access is decided by the database admin role, never by a username or a password shipped to the browser. */
export async function canAccessBeta(userId: string | undefined): Promise<boolean> {
  if (!userId) return false;
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  return data === true;
}

export async function loadBetaFlags(): Promise<Record<string, boolean>> {
  const { data } = await supabase.from("beta_features").select("feature_name, enabled");
  const out: Record<string, boolean> = {};
  for (const r of data ?? []) out[r.feature_name] = r.enabled;
  return out;
}

export async function setBetaFlag(name: BetaFlagName, enabled: boolean, userId: string) {
  const { error } = await supabase
    .from("beta_features")
    .upsert(
      { feature_name: name, enabled, tested_by: userId, updated_at: new Date().toISOString() },
      { onConflict: "feature_name" },
    );
  if (error) throw error;
}
