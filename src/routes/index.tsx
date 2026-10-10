import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function Auth() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
    if (error) toast.error(error.message);
  };
  
  const signInWithApple = async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'apple', options: { redirectTo: window.location.origin } });
    if (error) toast.error(error.message);
  };

  const signInWithEmail = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // Try sign up if sign in fails
      const { error: signUpError } = await supabase.auth.signUp({ email, password });
      if (signUpError) toast.error(signUpError.message);
      else toast.success("Check email to confirm");
    } else {
      toast.success("Signed in");
      window.location.href = "/";
    }
    setLoading(false);
  };

  const signInWithPhone = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) toast.error(error.message);
    else toast.success("Code sent to phone");
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-3xl font-bold text-center">CoolerUp</h1>
        
        {/* Email */}
        <div className="space-y-3 bg-zinc-900 p-4 rounded-xl">
          <p className="text-sm font-semibold">Email</p>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" className="w-full p-3 rounded bg-zinc-800 border border-zinc-700" />
          <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="password" className="w-full p-3 rounded bg-zinc-800 border border-zinc-700" />
          <button onClick={signInWithEmail} disabled={loading} className="w-full bg-white text-black p-3 rounded-full font-bold">
            {loading ? "Loading..." : "Continue with Email"}
          </button>
        </div>

        {/* Phone */}
        <div className="space-y-3 bg-zinc-900 p-4 rounded-xl">
          <p className="text-sm font-semibold">Phone</p>
          <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 555..." className="w-full p-3 rounded bg-zinc-800 border border-zinc-700" />
          <button onClick={signInWithPhone} className="w-full bg-zinc-800 p-3 rounded-full font-bold border border-zinc-700">Continue with Phone</button>
        </div>

        {/* OAuth */}
        <div className="space-y-3">
          <button onClick={signInWithGoogle} className="w-full bg-white text-black p-3 rounded-full font-bold flex items-center justify-center gap-2">
            <img src="https://www.svgrepo.com/show/475656/google-color.svg" className="w-5 h-5" /> Continue with Google
          </button>
          <button onClick={signInWithApple} className="w-full bg-zinc-800 p-3 rounded-full font-bold flex items-center justify-center gap-2 border border-zinc-700">
            Apple Continue with Apple
          </button>
        </div>
      </div>
    </div>
  );
}
