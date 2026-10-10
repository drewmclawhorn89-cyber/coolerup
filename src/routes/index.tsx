import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/")({ component: Index });

function Index() {
  const auth: any = useAuth();
  const [videos, setVideos] = useState<any[]>([]);

  useEffect(() => {
    supabase.from("videos").select("*").then(({ data }) => { if (data) setVideos(data); });
  }, []);

  const phoneLogin = async () => {
    const phone = prompt("Phone with +1 ex +19195551234");
    if (!phone) return;
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) return alert(error.message);
    const code = prompt("6-digit code sent to " + phone);
    if (!code) return;
    const { error: e2 } = await supabase.auth.verifyOtp({ phone, token: code, type: 'sms' });
    if (e2) alert(e2.message); else location.reload();
  };

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h1>coolerup - FREE VERSION</h1>
      {!auth.user ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 300, marginTop: 20 }}>
          <button onClick={auth.signIn} style={{ padding: 14, borderRadius: 10, background: 'black', color: 'white', fontWeight: 'bold' }}>Sign in with Google</button>
          <button onClick={phoneLogin} style={{ padding: 14, borderRadius: 10, background: '#eee', fontWeight: 'bold' }}>Sign in with Phone - FREE</button>
        </div>
      ) : (
        <div style={{ marginTop: 20 }}>
          <p>Signed in: {auth.user.email}</p>
          <button onClick={auth.signOut}>Sign out</button>
          <p style={{ marginTop: 20 }}>{videos.length} videos</p>
        </div>
      )}
    </div>
  );
}
