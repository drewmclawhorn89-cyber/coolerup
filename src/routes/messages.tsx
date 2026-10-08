import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/messages")({
  head: () => ({
    meta: [
      { title: "Messages — Loop" },
      { name: "description", content: "Chat with creators on Loop." },
      { property: "og:title", content: "Messages — Loop" },
      { property: "og:description", content: "Chat with creators on Loop." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Messages,
});

type Msg = { id: string; from_username: string; to_username: string; message: string; created_at: string };

function Messages() {
  const auth = useAuth();
  const me = auth.handle;
  const [toUser, setToUser] = useState("");
  const [text, setText] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const u = new URLSearchParams(window.location.search).get("user");
    if (u) setToUser(u);
  }, []);

  const load = async () => {
    const { data } = await supabase
      .from("direct_messages")
      .select("id, from_username, to_username, message, created_at")
      .order("created_at", { ascending: true });
    setMsgs((data ?? []) as Msg[]);
  };

  useEffect(() => {
    if (auth.user) load();
  }, [auth.user?.id]);

  useEffect(() => endRef.current?.scrollIntoView(), [msgs.length, toUser]);

  const send = async () => {
    const body = text.trim();
    const to = toUser.trim().replace(/^@/, "").toLowerCase();
    if (!body || !to || !auth.user || !me) return;
    const { data: target } = await supabase.from("profiles").select("id").eq("handle", to).maybeSingle();
    if (!target) return toast.error(`@${to} hasn't joined Loop yet`);
    const { error } = await supabase
      .from("direct_messages")
      .insert({ from_id: auth.user.id, to_id: target.id, from_username: me, to_username: to, message: body });
    if (error) return toast.error("Couldn't send message");
    setText("");
    load();
  };

  const inbox = new Map<string, Msg>();
  msgs.forEach((m) => inbox.set(m.from_username === me ? m.to_username : m.from_username, m));
  const convo = msgs.filter((m) => m.from_username === toUser || m.to_username === toUser);

  if (auth.ready && !auth.user) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <p className="font-display text-2xl">Your messages</p>
        <p className="text-muted-foreground">Sign in to send and read private messages.</p>
        <Button onClick={auth.signIn}>Sign in with Google</Button>
        <Link to="/" className="text-sm text-muted-foreground">Back to Loop</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-dvh max-w-md flex-col bg-background pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <div className="border-b p-4">
        <div className="flex items-center gap-3">
          <Link to="/" aria-label="Back to Loop" className="text-muted-foreground hover:text-foreground"><ArrowLeft className="h-5 w-5" /></Link>
          <h1 className="font-display text-xl">Messages</h1>
        </div>
        <input
          value={toUser}
          onChange={(e) => setToUser(e.target.value)}
          placeholder="Message @username"
          className="mt-3 w-full rounded-full border bg-secondary px-4 py-2 text-sm outline-none"
        />
      </div>

      {toUser === "" ? (
        <div className="flex-1 overflow-y-auto p-2">
          <p className="px-3 py-2 text-xs font-bold tracking-widest text-muted-foreground">INBOX</p>
          {inbox.size === 0 ? (
            <p className="mt-20 text-center text-muted-foreground">No messages yet</p>
          ) : (
            [...inbox.entries()].reverse().map(([user, last]) => (
              <button key={user} onClick={() => setToUser(user)} className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-secondary">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary font-display uppercase text-primary-foreground">{user[0]}</div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">@{user}</p>
                  <p className="truncate text-xs text-muted-foreground">{last.message}</p>
                </div>
              </button>
            ))
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b p-3">
            <button onClick={() => setToUser("")} className="text-sm font-bold text-primary">← Inbox</button>
            <span className="font-bold">@{toUser}</span>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {convo.map((m) => (
              <div key={m.id} className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${m.from_username === me ? "ml-auto bg-primary text-primary-foreground" : "bg-secondary"}`}>
                {m.message}
              </div>
            ))}
            <div ref={endRef} />
          </div>
          <div className="flex gap-2 border-t p-3">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Message..."
              maxLength={2000}
              className="min-w-0 flex-1 rounded-full border bg-secondary px-4 py-2 outline-none"
            />
            <Button onClick={send} className="rounded-full">Send</Button>
          </div>
        </>
      )}
    </div>
  );
}
