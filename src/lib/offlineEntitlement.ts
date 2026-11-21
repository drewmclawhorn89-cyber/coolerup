import { supabase } from "@/integrations/supabase/client";

/** Asks the server whether the signed-in account's plan includes offline saving. */
export async function requireOfflineEntitlement(kind: "video" | "music"): Promise<void> {
  const { data, error } = await supabase.rpc("my_offline_entitlement");
  const ok =
    !error && data && typeof data === "object" && (data as Record<string, unknown>)[kind] === true;
  if (!ok) {
    throw new Error(
      kind === "music"
        ? "Offline music needs an active VIP plan on your account."
        : "Offline videos need an active paid plan on your account.",
    );
  }
}
