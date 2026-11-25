import { useEffect } from "react";

import { useAuth } from "@/hooks/useAuth";
import { clearAccountSubscriptionCache, loadAccountSubscription } from "@/lib/accountSubscriptions";
import { clearLifetimeCache, refreshLifetime } from "@/lib/subscription";

/**
 * Keeps the in-memory subscription cache in step with the signed-in account.
 *
 * On login (or app start with a session) it fetches
 * `public.user_subscriptions` and lifetime grants for the signed-in `user_id`,
 * so a plan bought on any phone or browser loads automatically without tapping
 * Restore. On logout it wipes the in-memory cache cleanly.
 */
export function SubscriptionSync() {
  const auth = useAuth();
  const userId = auth.user?.id ?? null;
  const handle = auth.handle;

  useEffect(() => {
    if (!userId) {
      clearAccountSubscriptionCache();
      clearLifetimeCache();
      return;
    }
    void loadAccountSubscription(userId, handle);
    if (handle) {
      void refreshLifetime(handle);
    }
  }, [userId, handle]);

  return null;
}
