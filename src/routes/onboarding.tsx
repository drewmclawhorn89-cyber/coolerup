import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Camera, Check, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { refreshProfile, useAuth } from "@/hooks/useAuth";
import {
  MIN_AGE,
  USERNAME_MAX,
  checkUsernameAvailable,
  normalizeUsername,
  saveOnboarding,
  validateBirthday,
  validateUsername,
} from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Finish your profile — Coolerup" },
      { name: "description", content: "Pick a username and add your birthday to start posting." },
    ],
  }),
  component: OnboardingPage,
});

const STEPS = ["Username", "Birthday", "Profile"] as const;
const AVATAR_PREFIX = "avatars:";

/** Latest date that still makes someone at least 13 today. */
function maxBirthday(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - MIN_AGE);
  return d.toISOString().slice(0, 10);
}

function OnboardingPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [username, setUsername] = useState("");
  const [birthday, setBirthday] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const seeded = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Pre-fill once the profile loads. Old accounts already have a handle, so we
  // show it instead of asking them to invent a new name — and we never
  // overwrite what they already chose.
  useEffect(() => {
    if (!auth.user || !auth.onboarding.ready || seeded.current) return;
    seeded.current = true;
    const existing = auth.onboarding.username ?? auth.handle ?? "";
    setUsername(existing);
    setBirthday(auth.onboarding.birthday ?? "");
    setDisplayName(auth.profile?.display_name ?? auth.name ?? "");
    setBio(auth.profile?.bio ?? "");
    setPreview(auth.avatar);
    // Old accounts with a username only need the missing birthday.
    if (auth.onboarding.username && !auth.onboarding.birthday) setStep(1);
  }, [
    auth.user,
    auth.onboarding.ready,
    auth.onboarding.username,
    auth.onboarding.birthday,
    auth.handle,
    auth.profile,
    auth.name,
    auth.avatar,
  ]);

  // Already finished? Go straight to For You.
  useEffect(() => {
    if (auth.user && auth.onboarding.ready && auth.onboarding.complete) {
      void navigate({ to: "/" });
    }
  }, [auth.user, auth.onboarding.ready, auth.onboarding.complete, navigate]);

  // Debounced availability check on step 1.
  useEffect(() => {
    if (step !== 0) return;
    const value = normalizeUsername(username);
    setAvailable(null);
    if (!value) {
      setUsernameError(null);
      return;
    }
    const own = auth.onboarding.username ?? auth.handle;
    const local = validateUsername(value, own);
    if (!local.ok) {
      setUsernameError(local.error);
      return;
    }
    if (own && normalizeUsername(own) === value) {
      setUsernameError(null);
      setAvailable(true);
      return;
    }
    setUsernameError(null);
    setChecking(true);
    const id = window.setTimeout(async () => {
      const result = await checkUsernameAvailable(value, auth.user?.id ?? "", own);
      setChecking(false);
      setAvailable(result.available);
      setUsernameError(result.available ? null : (result.error ?? "Username unavailable"));
    }, 450);
    return () => {
      window.clearTimeout(id);
      setChecking(false);
    };
  }, [username, step, auth.user?.id, auth.onboarding.username, auth.handle]);

  const pickPhoto = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return void toast.error("Pick an image file");
    if (file.size > 5 * 1024 * 1024) return void toast.error("Photos must be under 5 MB");
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  };

  const nextFromUsername = () => {
    const own = auth.onboarding.username ?? auth.handle;
    const local = validateUsername(username, own);
    if (!local.ok) return void setUsernameError(local.error);
    if (available === false) return void setUsernameError(usernameError ?? "Username unavailable");
    setStep(1);
  };

  const nextFromBirthday = () => {
    const error = validateBirthday(birthday);
    if (error) return void toast.error(error);
    setStep(2);
  };

  const finish = async () => {
    if (!auth.user || saving) return;
    const birthdayError = validateBirthday(birthday);
    if (birthdayError) {
      setStep(1);
      return void toast.error(birthdayError);
    }
    setSaving(true);
    try {
      let avatarUrl: string | undefined;
      if (photo) {
        const ext = photo.name.split(".").pop() || "jpg";
        const path = `${auth.user.id}/avatar.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(path, photo, { contentType: photo.type, upsert: true });
        if (uploadError) throw uploadError;
        avatarUrl = AVATAR_PREFIX + path;
      }
      const result = await saveOnboarding(auth.user, {
        username,
        birthday,
        displayName,
        bio,
        ...(avatarUrl ? { avatarUrl } : {}),
      });
      if (!result.ok) {
        if (/username|taken|reserved|auto-generated|bot/i.test(result.error)) setStep(0);
        return void toast.error(result.error);
      }
      refreshProfile();
      toast.success("Welcome to Coolerup");
      void navigate({ to: "/" });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't save your profile");
    } finally {
      setSaving(false);
    }
  };

  if (auth.ready && !auth.user) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 text-center">
          <h1 className="font-display text-2xl">Finish your profile</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in first so we can attach your username and birthday to your account.
          </p>
          <Button className="mt-6 w-full rounded-full" onClick={() => void auth.signIn()}>
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background px-4 py-8">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <p className="font-display text-xl">Finish your profile</p>
          <span className="text-xs font-bold text-muted-foreground">
            Step {step + 1} of {STEPS.length}
          </span>
        </div>

        <div className="mb-8 flex gap-2" aria-hidden>
          {STEPS.map((label, i) => (
            <div key={label} className="flex-1">
              <div className={`h-1.5 rounded-full ${i <= step ? "bg-primary" : "bg-secondary"}`} />
              <p
                className={`mt-1.5 text-[10px] font-bold uppercase tracking-wide ${
                  i <= step ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {label}
              </p>
            </div>
          ))}
        </div>

        {step === 0 && (
          <section className="space-y-4">
            <div>
              <h2 className="font-display text-2xl">Pick your username</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                This is how people find you. You can keep your current one.
              </p>
            </div>
            <div>
              <div className="flex items-center rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
                <span className="pl-3 text-muted-foreground">@</span>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))}
                  maxLength={USERNAME_MAX}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="yourname"
                  className="border-0 bg-transparent pl-1 focus-visible:ring-0"
                  aria-label="Username"
                  autoFocus
                />
                <span className="pr-3">
                  {checking ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : available === true ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : null}
                </span>
              </div>
              <p
                className={`mt-1.5 min-h-4 text-xs ${
                  usernameError
                    ? "text-destructive"
                    : available
                      ? "text-green-500"
                      : "text-muted-foreground"
                }`}
              >
                {usernameError ??
                  (available
                    ? `@${normalizeUsername(username)} is available`
                    : "3–30 letters, numbers, dots or underscores")}
              </p>
            </div>
            <Button
              className="w-full rounded-full"
              onClick={nextFromUsername}
              disabled={checking || !username.trim()}
            >
              Next
            </Button>
          </section>
        )}

        {step === 1 && (
          <section className="space-y-4">
            <div>
              <h2 className="font-display text-2xl">When's your birthday?</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                You must be at least {MIN_AGE} to use Coolerup. We only use this to keep the app
                safe for everyone.
              </p>
            </div>
            <Input
              type="date"
              value={birthday}
              max={maxBirthday()}
              onChange={(e) => setBirthday(e.target.value)}
              aria-label="Birthday"
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 rounded-full" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button
                className="flex-1 rounded-full"
                onClick={nextFromBirthday}
                disabled={!birthday}
              >
                Next
              </Button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="space-y-4">
            <div>
              <h2 className="font-display text-2xl">Make it yours</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Optional — add a photo, display name and a short bio.
              </p>
            </div>

            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full bg-primary text-2xl uppercase text-primary-foreground"
              >
                {preview ? (
                  <img src={preview} alt="Profile photo" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center">
                    {(displayName || username || "?").charAt(0)}
                  </span>
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white">
                  <Camera className="h-5 w-5" />
                </span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)}
              />
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-xs text-muted-foreground">Display name</label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={60}
                  placeholder="Your name"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Bio <span className="opacity-60">({bio.length}/160)</span>
              </label>
              <Textarea
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, 160))}
                rows={3}
                placeholder="Tell people a little about you"
              />
            </div>

            <div className="rounded-xl bg-secondary p-3 text-xs text-muted-foreground">
              <p className="flex items-center gap-1.5 font-bold text-foreground">
                <Lock className="h-3.5 w-3.5" /> Your videos stay put
              </p>
              <p className="mt-1">
                Finishing your profile only updates your account details. Every video and like you
                already have stays linked to you.
              </p>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 rounded-full" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button
                className="flex-1 rounded-full"
                onClick={() => void finish()}
                disabled={saving}
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Finish — Go to Coolerup
              </Button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
