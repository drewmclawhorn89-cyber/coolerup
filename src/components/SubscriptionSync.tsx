import { useEffect } from "react";

import { useAuth } from "@/hooks/useAuth";
import { clearAccountSubscriptionCache, loadAccountSubscription } from "@/lib/accountSubscriptions";
import { refreshLifetime } from "@/lib/subscription";

/**
 * Keeps the cached account subscription in step with the signed-in user.
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
    if (handle) {
      void refreshLifetime(handle);
    }
  }, [userId, handle]);

  return null;
}
