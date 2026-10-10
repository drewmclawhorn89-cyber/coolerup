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
    const { error } = await supabase
      .from("blocked_users")
      .insert({ blocker_id: auth.user.id, blocker_username: auth.handle, blocked_username: username });
    if (error && error.code !== "23505") {
      toast.error("Couldn't block");
      return;
    }
    toast.success(`Blocked @${username}`);
    window.dispatchEvent(new Event(BLOCK_EVENT));
  };

  const unblock = async (username: string) => {
    if (!auth.user) return;
    const { error } = await supabase.from("blocked_users").delete().eq("blocker_id", auth.user.id).eq("blocked_username", username);
    if (error) {
      toast.error("Couldn't unblock");
      return;
    }
    toast.success(`Unblocked @${username}`);
    window.dispatchEvent(new Event(BLOCK_EVENT));
  };

  return { blocked, block, unblock };
}
