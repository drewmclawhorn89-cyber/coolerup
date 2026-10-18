// Phone login requires the Phone provider (with an SMS provider like Twilio) to be enabled:
// Enable Phone in Supabase Dashboard > Auth > Providers.
import { useEffect, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { OPEN_AUTH_EVENT } from "@/hooks/useAuth";
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

const E164 = /^\+[1-9]\d{7,14}$/;
const OTP_LENGTH = 6;

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits ? `+${digits}` : "+";
}

export function PhoneAuthForm({ onSuccess }: { onSuccess: () => void }) {
  const [phone, setPhone] = useState("+1");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);

  const sendCode = async (e?: FormEvent) => {
    e?.preventDefault();
    const target = normalizePhone(phone);
    if (!E164.test(target)) {
      toast.error("Enter a valid phone number with country code");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ phone: target });
    setLoading(false);
    if (error) {
      toast.error(error.message || "Couldn't send code");
      return;
    }
    setSentTo(target);
    setToken("");
    toast.success(`Code sent to ${target}`);
  };

  const verify = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!sentTo || token.length !== OTP_LENGTH) return;
    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({ phone: sentTo, token, type: "sms" });
    setLoading(false);
    if (error) {
      toast.error(error.message || "Invalid code");
      setToken("");
      return;
    }
    onSuccess();
  };

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
        Enter the 6-digit code sent to <span className="font-semibold text-foreground">{sentTo}</span>
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
          onClick={() => setSentTo(null)}
        >
          Change number
        </button>
        <button
          type="button"
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
          onClick={() => void sendCode()}
          disabled={loading}
        >
          Resend code
        </button>
      </div>
    </form>
  );
}

export function PhoneAuthDialog() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("phone");

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

  const signInWithGoogle = async () => {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) toast.error("Google sign-in failed");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm border-border bg-card">
        <DialogHeader>
          <DialogTitle>Sign in to coolerup</DialogTitle>
          <DialogDescription>Use your phone number or email to continue.</DialogDescription>
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
        <Button variant="outline" className="w-full rounded-full" onClick={signInWithGoogle}>
          Continue with Google
        </Button>
      </DialogContent>
    </Dialog>
  );
}
