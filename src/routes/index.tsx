import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const auth: any = useAuth();
  const [videos, setVideos] = useState<any[]>([]);

  useEffect(() => {
    supabase.from("videos").select("*").then(({ data }) => {
      if (data) setVideos(data);
    });
  }, []);

  const handlePhone = async () => {
    const phone = prompt("Phone with + country code, ex +19195551234");
    if (!phone) return;
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) { alert(error.message); return; }
    const code = prompt("Code sent to " + phone);
    if (!code) return;
    const { error: e2 } = await supabase.auth.verifyOtp({ phone, token: code, type: 'sms' });
    if (e2) alert(e2.message); else location.reload();
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>coolerup</h1>
      {!auth.user ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 20 }}>
          <button onClick={auth.signIn} style={{ padding: 12, background: 'white', color: 'black', borderRadius: 8, fontWeight: 'bold' }}>
            Sign in with Google
          </button>
          <button onClick={handlePhone} style={{ padding: 12, background: '#eee', borderRadius: 8, fontWeight: 'bold' }}>
            Sign in with Phone
          </button>
          <p>{videos.length} videos loaded</p>
        </div>
      ) : (
        <div>
          <p>Signed in as {auth.user?.email || auth.name}</p>
          <button onClick={auth.signOut}>Sign out</button>
        </div>
      )}
    </div>
  );
}
