import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import type { User as FirebaseUser } from "firebase/auth";
import { supabase } from "@/integrations/supabase/client";
import { onFirebasePhoneUserChange, signOutFirebasePhone } from "@/lib/firebase";
import { toast } from "sonner";

export type Profile = {
  id: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  links?: Record<string, string> | null;
  /** Whether the user's liked videos are visible on their profile. */
  show_liked?: boolean | null;
  /** Onboarding fields — nullable so pre-onboarding accounts keep working. */
  username?: string | null;
  birthday?: string | null;
  onboarding_complete?: boolean | null;
};

export type OnboardingStatus = {
  /** Profile row is loaded (or confirmed missing). */
  ready: boolean;
  complete: boolean;
  needsOnboarding: boolean;
  /** Account was created moments ago, so send it straight to /onboarding. */
  isNewUser: boolean;
  username: string | null;
  birthday: string | null;
};

/** How long after signup we treat an account as "new" and force onboarding. */
const NEW_USER_WINDOW_MS = 30 * 60 * 1000;

const FIREBASE_PROFILE_PREFIX = "coolerup:firebase-profile:";

const PROFILE_EVENT = "loop-profile-changed";
/** Tell every screen to reload the signed-in profile (after editing it). */
export const refreshProfile = () => window.dispatchEvent(new Event(PROFILE_EVENT));

export const OPEN_AUTH_EVENT = "loop-open-auth";
/** Open the sign-in dialog (Phone | Email | Google), mounted once in the root route. */
export const openAuthDialog = () => window.dispatchEvent(new Event(OPEN_AUTH_EVENT));

export type AuthValue = {
  user: User | null;
  ready: boolean;
  name: string | null;
  handle: string | null;
  avatar: string | null;
  profile: Profile | null;
  isAdmin: boolean;
  onboarding: OnboardingStatus;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

function mapFirebaseUserToSessionUser(fb: FirebaseUser): User {
  return {
    id: fb.uid,
    aud: "authenticated",
    role: "authenticated",
    phone: fb.phoneNumber ?? undefined,
    email: fb.email ?? undefined,
    created_at: fb.metadata.creationTime
      ? new Date(fb.metadata.creationTime).toISOString()
      : new Date().toISOString(),
    app_metadata: { provider: "phone", providers: ["phone"] },
    user_metadata: {
      phone_number: fb.phoneNumber ?? undefined,
      full_name: fb.displayName ?? undefined,
      avatar_url: fb.photoURL ?? undefined,
    },
  } as User;
}

function readLocalFirebaseProfile(uid: string): Profile | null {
  try {
    const raw = localStorage.getItem(`${FIREBASE_PROFILE_PREFIX}${uid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Profile | null;
    return parsed && parsed.id === uid && parsed.handle ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocalFirebaseProfile(profile: Profile): void {
  try {
    localStorage.setItem(`${FIREBASE_PROFILE_PREFIX}${profile.id}`, JSON.stringify(profile));
  } catch {
    // Ignore storage quota errors in private browsing.
  }
}

/**
 * The auth session is app-global, so it must be loaded exactly once and shared.
 * Previously every VideoCard ran its own subscription + profile fetch, which
 * meant ~20 duplicate auth listeners and network requests per feed page.
 */
function useAuthState(): AuthValue {
  const [supabaseUser, setSupabaseUser] = useState<User | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [sbReady, setSbReady] = useState(false);
  const [fbReady, setFbReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [resolvedAvatar, setResolvedAvatar] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      setSupabaseUser(session?.user ?? null);
      setSbReady(true);
    });
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSupabaseUser(data.session?.user ?? null);
        setSbReady(true);
      })
      .catch(() => {
        setSupabaseUser(null);
        setSbReady(true);
      });
    const unsubFirebase = onFirebasePhoneUserChange((fbUser) => {
      setFirebaseUser(fbUser);
      setFbReady(true);
    });
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(PROFILE_EVENT, bump);
    return () => {
      data.subscription.unsubscribe();
      unsubFirebase();
      window.removeEventListener(PROFILE_EVENT, bump);
    };
  }, []);

  const isFirebaseSession = !supabaseUser && !!firebaseUser;
  const user = useMemo<User | null>(
    () => supabaseUser ?? (firebaseUser ? mapFirebaseUserToSessionUser(firebaseUser) : null),
    [supabaseUser, firebaseUser],
  );
  const ready = sbReady && fbReady;

  const googleName: string | null =
    user?.user_metadata?.["full_name"] ||
    user?.user_metadata?.["name"] ||
    user?.email?.split("@")[0] ||
    null;
  const derivedHandle = googleName
    ? googleName
        .toLowerCase()
        .replace(/[^a-z0-9._]/g, "")
        .slice(0, 40) || "user"
    : user?.phone
      ? `user${user.phone.replace(/\D/g, "").slice(-4)}`
      : null;

  // Load (or create on first sign-in) this account's profile. Edited values are never overwritten.
  useEffect(() => {
    if (!user) {
      setProfile(null);
      setIsAdmin(false);
      setResolvedAvatar(null);
      setProfileLoaded(false);
      return;
    }
    let alive = true;
    setProfileLoaded(false);
    (async () => {
      try {
        if (isFirebaseSession) {
          const existing = readLocalFirebaseProfile(user.id);
          const fallbackHandle = derivedHandle ?? `user${user.id.slice(0, 4)}`;
          const row: Profile = existing ?? {
            id: user.id,
            handle: fallbackHandle,
            username: fallbackHandle,
            display_name: null,
            bio: null,
            avatar_url: null,
            onboarding_complete: true,
          };
          if (!existing) {
            writeLocalFirebaseProfile(row);
          }
          if (!alive) return;
          setProfile(row);
          setResolvedAvatar(row.avatar_url ?? null);
          setIsAdmin(false);
          return;
        }

        // `my_profile()` is a SECURITY DEFINER function that returns the caller's
        // own row, including the private columns (birthday, venmo_handle) that are
        // no longer granted to clients on the table itself.
        const readMine = async (): Promise<Profile | null> => {
          const { data } = await supabase.rpc("my_profile");
          const rows = (data ?? []) as unknown as Profile[];
          return Array.isArray(rows) ? (rows[0] ?? null) : ((rows as unknown as Profile) ?? null);
        };

        let row = await readMine();
        if (!row && derivedHandle) {
          let res = await supabase
            .from("profiles")
            .insert({ id: user.id, handle: derivedHandle })
            .select("id")
            .single();
          if (res.error?.code === "23505" && !googleName) {
            res = await supabase
              .from("profiles")
              .insert({ id: user.id, handle: `${derivedHandle}_${user.id.slice(0, 4)}` })
              .select("id")
              .single();
          }
          if (res.error?.code === "23505") {
            toast.error(`@${derivedHandle} is taken — pick a username in Settings`);
          }
          row = res.error ? null : await readMine();
        }
        const { data: role } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "admin")
          .maybeSingle();
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
      } catch {
        if (!alive) return;
        setProfile(null);
        setResolvedAvatar(null);
        setIsAdmin(false);
      } finally {
        if (alive) setProfileLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [user?.id, isFirebaseSession, derivedHandle, googleName, version]);

  const handle = profile?.handle ?? null;
  const name: string | null = profile?.display_name || googleName;
  const avatar: string | null = resolvedAvatar || user?.user_metadata?.["avatar_url"] || null;

  // Onboarding is derived from the profile row so it updates the moment the
  // user finishes /onboarding (refreshProfile bumps `version`).
  const onboarding = useMemo<OnboardingStatus>(() => {
    const complete = isFirebaseSession
      ? true
      : !!profile?.username && !!profile?.birthday && profile.onboarding_complete === true;
    const createdMs = user?.created_at ? new Date(user.created_at).getTime() : 0;
    const isNewUser = !!user && createdMs > 0 && Date.now() - createdMs < NEW_USER_WINDOW_MS;
    return {
      ready: !!user && profileLoaded,
      complete,
      needsOnboarding: !!user && profileLoaded && !complete,
      isNewUser,
      username: profile?.username ?? null,
      birthday: profile?.birthday ?? null,
    };
  }, [user, profile, profileLoaded, isFirebaseSession]);

  const signIn = async () => {
    openAuthDialog();
  };
  const signOut = async () => {
    await Promise.all([supabase.auth.signOut(), signOutFirebasePhone()]);
  };

  return useMemo(
    () => ({ user, ready, name, handle, avatar, profile, isAdmin, onboarding, signIn, signOut }),
    [user, ready, name, handle, avatar, profile, isAdmin, onboarding],
  );
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const value = useAuthState();
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Read the single shared auth session. Must be used inside <AuthProvider>. */
export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
