import { useEffect } from "react";

import { useAuth } from "@/hooks/useAuth";
import {
  clearAccountSubscriptionCache,
  loadAccountSubscription,
} from "@/lib/accountSubscriptions";

/**
 * Keeps the in-memory subscription cache in step with the signed-in account.
 *
 * On login (or app start with a session) it fetches
 * `public.user_subscriptions` for the auth user id, so a plan bought on another
 * phone appears here automatically. On logout it wipes the cache so nothing
 * from the previous account is shown.
 */
export function SubscriptionSync() {
  const auth = useAuth();
  const userId = auth.user?.id ?? null;
  const handle = auth.handle;

  useEffect(() => {
    if (!userId) {
      clearAccountSubscriptionCache();
      return;
    }
    void loadAccountSubscription(userId, handle);
  }, [userId, handle]);

  return null;
}
