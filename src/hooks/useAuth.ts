import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { toast } from "sonner";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const name: string | null =
    user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split("@")[0] || null;
  const handle = name
    ? name.toLowerCase().replace(/[^a-z0-9._]/g, "").slice(0, 40) || "user"
    : null;
  const avatar: string | null = user?.user_metadata?.avatar_url ?? null;

  const signIn = async () => {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) toast.error("Google sign-in failed");
  };
  const signOut = () => supabase.auth.signOut();

  return { user, ready, name, handle, avatar, signIn, signOut };
}
