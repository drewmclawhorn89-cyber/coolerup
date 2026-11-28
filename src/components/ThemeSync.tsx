import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { loadAccountTheme } from "@/lib/themeAccount";

/**
 * Keeps the active app theme synchronized with the signed-in user's account
 * across phones/browsers whenever auth state changes.
 */
export function ThemeSync() {
  const auth = useAuth();

  useEffect(() => {
    if (!auth.ready) return;
    void loadAccountTheme(auth.user?.id);
  }, [auth.ready, auth.user?.id]);

  return null;
}
