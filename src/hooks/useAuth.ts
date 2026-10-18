import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type Profile = {
  id: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
};

const PROFILE_EVENT = "loop-profile-changed";
/** Tell every screen to reload the signed-in profile (after editing it). */
export const refreshProfile = () => window.dispatchEvent(new Event(PROFILE_EVENT));

export const OPEN_AUTH_EVENT = "loop-open-auth";
/** Open the sign-in dialog (Phone | Email | Google), mounted once in the root route. */
export const openAuthDialog = () => window.dispatchEvent(new Event(OPEN_AUTH_EVENT));

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [resolvedAvatar, setResolvedAvatar] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setReady(true);
    });
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(PROFILE_EVENT, bump);
    return () => {
      data.subscription.unsubscribe();
      window.removeEventListener(PROFILE_EVENT, bump);
    };
  }, []);

  const googleName: string | null =
    user?.user_metadata?.["full_name"] || user?.user_metadata?.["name"] || user?.email?.split("@")[0] || null;
  const derivedHandle = googleName
    ? googleName.toLowerCase().replace(/[^a-z0-9._]/g, "").slice(0, 40) || "user"
    : user?.phone
      ? `user${user.phone.replace(/\D/g, "").slice(-4)}`
      : null;

  // Load (or create on first sign-in) this account's profile. Edited values are never overwritten.
  useEffect(() => {
    if (!user) {
      setProfile(null);
      setIsAdmin(false);
      return;
    }
    let alive = true;
    (async () => {
      const { data } = await supabase.from("profiles").select("id, handle, display_name, bio, avatar_url").eq("id", user.id).maybeSingle();
      let row = data as Profile | null;
      if (!row && derivedHandle) {
        const res = await supabase
          .from("profiles")
          .insert({ id: user.id, handle: derivedHandle })
          .select("id, handle, display_name, bio, avatar_url")
          .single();
        if (res.error?.code === "23505") toast.error(`@${derivedHandle} is taken — pick a username in Settings`);
        row = (res.data as Profile | null) ?? null;
      }
      const { data: role } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
      let avatarUrl: string | null = null;
      if (row?.avatar_url?.startsWith("avatars:")) {
        const { data: signed } = await supabase.storage
          .from("avatars")
          .createSignedUrl(row.avatar_url.slice("avatars:".length), 60 * 60 * 6);
        avatarUrl = signed?.signedUrl ?? null;
      } else {
        avatarUrl = row?.avatar_url ?? null;
      }
      if (!alive) return;
      setProfile(row);
      setResolvedAvatar(avatarUrl);
      setIsAdmin(!!role);
    })();
    return () => {
      alive = false;
    };
  }, [user?.id, derivedHandle, version]);

  const handle = profile?.handle ?? null;
  const name: string | null = profile?.display_name || googleName;
  const avatar: string | null = resolvedAvatar || user?.user_metadata?.["avatar_url"] || null;

  const signIn = async () => openAuthDialog();
  const signOut = () => supabase.auth.signOut();

  return { user, ready, name, handle, avatar, profile, isAdmin, signIn, signOut };
}
