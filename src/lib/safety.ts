import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export const BANNED_TEXT = "User banned for violating community guidelines";

const banCache = new Map<string, Promise<boolean>>();

/** True when the username currently has an active ban (checked through the is_banned database function). */
export function checkBanned(username: string): Promise<boolean> {
  let result = banCache.get(username);
  if (!result) {
    result = Promise.resolve(supabase.rpc("is_banned", { _username: username }))
      .then(({ data }) => data === true)
      .catch(() => false);
    banCache.set(username, result);
  }
  return result;
}

export function useIsBanned(username?: string | null) {
  const [banned, setBanned] = useState(false);
  useEffect(() => {
    if (!username) {
      setBanned(false);
      return;
    }
    let alive = true;
    checkBanned(username).then((v) => alive && setBanned(v));
    return () => {
      alive = false;
    };
  }, [username]);
  return banned;
}

const BLOCK_EVENT = "loop-blocks-changed";

/** Normalise a handle so "@Cooler" and "cooler" compare equal. */
export function normaliseHandle(username?: string | null): string {
  return (username ?? "").trim().replace(/^@+/, "").toLowerCase();
}

let bannedHandlesPromise: Promise<Set<string>> | null = null;

/**
 * All handles with an active ban, lowercased and without the leading "@".
 * Cached for the session so the feed doesn't refetch it on every render.
 * Failures are not cached, so a transient error retries on the next call.
 */
export function loadBannedHandles(force = false): Promise<Set<string>> {
  if (!bannedHandlesPromise || force) {
    const request = Promise.resolve(supabase.rpc("banned_handles")).then(({ data, error }) => {
      if (error) throw error;
      return new Set((data ?? []).map((handle) => normaliseHandle(handle)));
    });
    bannedHandlesPromise = request.catch((error) => {
      bannedHandlesPromise = null;
      throw error;
    });
  }
  return bannedHandlesPromise;
}

/** True when this author is currently banned, so their content must be hidden. */
export function isBannedAuthor(banned: Set<string>, username?: string | null): boolean {
  const handle = normaliseHandle(username);
  return handle.length > 0 && banned.has(handle);
}

/** Set of banned handles for client-side filtering. Empty until the lookup resolves. */
export function useBannedHandles(): Set<string> {
  const [banned, setBanned] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    loadBannedHandles()
      .then((handles) => {
        if (alive) setBanned(handles);
      })
      .catch(() => {
        // RLS already hides banned authors; leave the set empty on failure.
      });
    return () => {
      alive = false;
    };
  }, []);
  return banned;
}

export function useBlocked() {
  const auth = useAuth();
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(BLOCK_EVENT, bump);
    return () => window.removeEventListener(BLOCK_EVENT, bump);
  }, []);

  useEffect(() => {
    if (!auth.user) {
      setBlocked(new Set());
      return;
    }
    supabase
      .from("blocked_users")
      .select("blocked_username")
      .eq("blocker_id", auth.user.id)
      .then(({ data }) => setBlocked(new Set((data ?? []).map((r) => r.blocked_username))));
  }, [auth.user?.id, version]);

  const block = async (username: string) => {
    if (!auth.user || !auth.handle) {
      void auth.signIn();
      return;
    }
    const { error } = await supabase.from("blocked_users").insert({
      blocker_id: auth.user.id,
      blocker_username: auth.handle,
      blocked_username: username,
    });
    if (error && error.code !== "23505") {
      toast.error("Couldn't block");
      return;
    }
    toast.success(`Blocked @${username}`);
    window.dispatchEvent(new Event(BLOCK_EVENT));
  };

  const unblock = async (username: string) => {
    if (!auth.user) return;
    const { error } = await supabase
      .from("blocked_users")
      .delete()
      .eq("blocker_id", auth.user.id)
      .eq("blocked_username", username);
    if (error) {
      toast.error("Couldn't unblock");
      return;
    }
    toast.success(`Unblocked @${username}`);
    window.dispatchEvent(new Event(BLOCK_EVENT));
  };

  return { blocked, block, unblock };
}
