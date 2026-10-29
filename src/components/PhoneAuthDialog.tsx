// Phone login requires the Phone provider (with an SMS provider like Twilio) to be enabled:
// Enable Phone in Supabase Dashboard > Auth > Providers.
// Apple login requires the Apple provider (Service ID + key) in the same place.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { OPEN_AUTH_EVENT } from "@/hooks/useAuth";
import { explainAuthError, normalizePhone } from "@/lib/phone";
import { EmailAuthForm } from "@/components/EmailAuthForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const OTP_LENGTH = 6;
const RESEND_SECONDS = 60;

export function PhoneAuthForm({ onSuccess }: { onSuccess: () => void }) {
  const [phone, setPhone] = useState("+1");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const verifyingRef = useRef(false);

  // Countdown so people can't hammer Supabase's SMS rate limit.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  const sendCode = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      if (loading || cooldown > 0) return;
      const target = normalizePhone(phone);
      if (!target) {
        toast.error("Enter a valid phone number with country code");
        return;
      }
      setLoading(true);
      const { error } = await supabase.auth.signInWithOtp({
        phone: target,
        options: { shouldCreateUser: true },
      });
      setLoading(false);
      if (error) {
        toast.error(explainAuthError(error.message, "Couldn't send code"));
        return;
      }
      setSentTo(target);
      setToken("");
      setCooldown(RESEND_SECONDS);
      toast.success(`Code sent to ${target}`);
    },
    [phone, loading, cooldown],
  );

  const verify = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      if (!sentTo || token.length !== OTP_LENGTH || verifyingRef.current) return;
      verifyingRef.current = true;
      setLoading(true);
      const { error } = await supabase.auth.verifyOtp({
        phone: sentTo,
        token,
        type: "sms",
      });
      setLoading(false);
      verifyingRef.current = false;
      if (error) {
        toast.error(explainAuthError(error.message, "Invalid code"));
        setToken("");
        return;
      }
      onSuccess();
    },
    [sentTo, token, onSuccess],
  );

  // Auto-submit as soon as the sixth digit lands, like a native SMS autofill.
  useEffect(() => {
    if (sentTo && token.length === OTP_LENGTH && !loading) void verify();
  }, [token, sentTo, loading, verify]);

  if (!sentTo) {
    return (
      <form onSubmit={sendCode} className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="auth-phone">Phone number</Label>
          <Input
            id="auth-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+1 555 123 4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            Include your country code. We'll text you a 6-digit code — new numbers get an account
            automatically.
          </p>
        </div>
        <Button type="submit" className="w-full rounded-full" disabled={loading}>
          {loading && <Loader2 className="animate-spin" />}
          Send Code
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="flex flex-col items-center gap-4">
      <p className="text-center text-sm text-muted-foreground">
        Enter the 6-digit code sent to{" "}
        <span className="font-semibold text-foreground">{sentTo}</span>
      </p>
      <InputOTP
        maxLength={OTP_LENGTH}
        value={token}
        onChange={setToken}
        autoComplete="one-time-code"
        inputMode="numeric"
        pattern="^[0-9]*$"
        aria-label="Verification code"
        autoFocus
      >
        <InputOTPGroup>
          {Array.from({ length: OTP_LENGTH }, (_, i) => (
            <InputOTPSlot key={i} index={i} />
          ))}
        </InputOTPGroup>
      </InputOTP>
      <Button
        type="submit"
        className="w-full rounded-full"
        disabled={loading || token.length !== OTP_LENGTH}
      >
        {loading && <Loader2 className="animate-spin" />}
        Verify
      </Button>
      <div className="flex w-full justify-between text-sm">
        <button
          type="button"
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          onClick={() => {
            setSentTo(null);
            setToken("");
            setCooldown(0);
          }}
        >
          Change number
        </button>
        <button
          type="button"
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
          onClick={() => void sendCode()}
          disabled={loading || cooldown > 0}
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
        </button>
      </div>
    </form>
  );
}

function AppleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 384 512" aria-hidden="true" className={className} fill="currentColor">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}

function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={className}>
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2.5 24 .5 14.6.5 6.5 5.9 2.6 13.7l7.8 6.1C12.3 13.7 17.6 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.1 24.5c0-1.6-.1-2.8-.4-4.1H24v8.4h12.5c-.3 2.1-1.6 5.2-4.6 7.3l7.6 5.9c4.5-4.2 6.6-10.3 6.6-17.5z"
      />
      <path
        fill="#FBBC05"
        d="M10.4 28.2A14.6 14.6 0 0 1 9.6 24c0-1.5.3-2.9.8-4.2l-7.8-6.1A23.9 23.9 0 0 0 .5 24c0 3.8.9 7.5 2.1 10.3l7.8-6.1z"
      />
      <path
        fill="#34A853"
        d="M24 47.5c6.2 0 11.5-2 15.5-5.6l-7.6-5.9c-2 1.4-4.8 2.4-7.9 2.4-6.4 0-11.7-4.2-13.6-10.2l-7.8 6.1C6.5 42.1 14.6 47.5 24 47.5z"
      />
    </svg>
  );
}

export function PhoneAuthDialog() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("phone");
  const [oauth, setOauth] = useState<"apple" | "google" | null>(null);

  useEffect(() => {
    const show = () => {
      setTab("phone");
      setOpen(true);
    };
    window.addEventListener(OPEN_AUTH_EVENT, show);
    return () => window.removeEventListener(OPEN_AUTH_EVENT, show);
  }, []);

  const handleSuccess = () => {
    setOpen(false);
    toast.success("You're signed in");
  };

  const signInWithOAuth = async (provider: "apple" | "google") => {
    if (oauth) return;
    setOauth(provider);
    const label = provider === "apple" ? "Apple" : "Google";
    try {
      const result = await lovable.auth.signInWithOAuth(provider, {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        const raw = result.error.message || "";
        const m = raw.toLowerCase();
        toast.error(
          m.includes("provider") || m.includes("not enabled") || m.includes("disabled")
            ? `${label} sign-in isn't enabled for this app yet. Use phone or email instead.`
            : `${label} sign-in failed. Please try again.`,
        );
      }
    } catch {
      toast.error(`${label} sign-in failed. Please try again.`);
    } finally {
      setOauth(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm border-border bg-card">
        <DialogHeader>
          <DialogTitle>Sign in to coolerup</DialogTitle>
          <DialogDescription>
            Use your phone number, email, Apple or Google to continue.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="phone">Phone</TabsTrigger>
            <TabsTrigger value="email">Email</TabsTrigger>
          </TabsList>
          <TabsContent value="phone" className="pt-2">
            <PhoneAuthForm onSuccess={handleSuccess} />
          </TabsContent>
          <TabsContent value="email" className="pt-2">
            <EmailAuthForm onSuccess={handleSuccess} />
          </TabsContent>
        </Tabs>

        <div className="flex items-center gap-3 text-xs uppercase text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        <div className="flex flex-col gap-2">
          <Button
            variant="outline"
            className="w-full rounded-full"
            onClick={() => void signInWithOAuth("apple")}
            disabled={oauth !== null}
            aria-label="Continue with Apple"
          >
            {oauth === "apple" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <AppleLogo className="h-4 w-4" />
            )}
            Continue with Apple
          </Button>
          <Button
            variant="outline"
            className="w-full rounded-full"
            onClick={() => void signInWithOAuth("google")}
            disabled={oauth !== null}
            aria-label="Continue with Google"
          >
            {oauth === "google" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <GoogleLogo className="h-4 w-4" />
            )}
            Continue with Google
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
