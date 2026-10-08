import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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

function Messages() {
  const myUsername = "drew"; // change to your real username later
  const [toUser, setToUser] = useState("");
  const [text, setText] = useState("");
  const [msgs, setMsgs] = useState<any[]>([]);
  const [inboxUsers, setInboxUsers] = useState<any[]>([]);

  useEffect(() => {
    const urlUser = new URLSearchParams(window.location.search).get("user");
    if (urlUser) setToUser(urlUser);
    load();
  }, []);

  const load = async () => {
    const { data } = await supabase
     .from("direct_messages")
     .select("*")
     .or(`from_username.eq.${myUsername},to_username.eq.${myUsername}`)
     .order("created_at", { ascending: true });

    if (data) {
      setMsgs(data);
      const map = new Map();
      data.forEach((m: any) => {
        const other = m.from_username === myUsername? m.to_username : m.from_username;
        map.set(other, m);
      });
      setInboxUsers(Array.from(map.entries()).map(([user, lastMsg]: any) => ({ user, lastMsg })));
    }
  };

  const send = async () => {
    if (!text.trim() ||!toUser) return alert("Pick a user!");
    await supabase.from("direct_messages").insert({ from_username: myUsername, to_username: toUser, message: text });
    setMsgs([...msgs, { from_username: myUsername, to_username: toUser, message: text, created_at: new Date().toISOString() }]);
    setText("");
    load();
  };

  const convo = msgs.filter((m: any) => (m.from_username === toUser && m.to_username === myUsername) || (m.from_username === myUsername && m.to_username === toUser));

  return (
    <div className="min-h-screen bg-black text-white max-w-md mx-auto flex flex-col">
      <div className="p-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold">Messages</h1>
        <input value={toUser} onChange={e => setToUser(e.target.value)} placeholder="Message @username" className="mt-3 w-full bg-zinc-900 border border-zinc-800 rounded-full px-4 py-2 text-sm" />
      </div>

      {toUser === ""? (
        <div className="flex-1 p-2">
          <p className="text-zinc-500 text-xs px-3 py-2">INBOX</p>
          {inboxUsers.length === 0? <p className="text-zinc-500 text-center mt-20">No messages yet</p> :
            inboxUsers.map(({ user, lastMsg }: any) => (
              <button key={user} onClick={() => setToUser(user)} className="w-full flex items-center gap-3 p-3 hover:bg-zinc-900 rounded-xl text-left">
                <div className="w-12 h-12 bg-zinc-800 rounded-full flex items-center justify-center font-bold">{user[0]?.toUpperCase()}</div>
                <div className="flex-1 overflow-hidden">
                  <p className="font-bold text-sm">@{user}</p>
                  <p className="text-xs text-zinc-400 truncate">{lastMsg.message}</p>
                </div>
              </button>
            ))
          }
        </div>
      ) : (
        <>
          <div className="p-3 border-b border-zinc-800 flex items-center gap-2">
            <button onClick={() => setToUser("")} className="text-[#00f2ea]">← Back</button>
            <span className="font-bold">@{toUser}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-zinc-950">
            {convo.map((m: any, i: number) => (
              <div key={i} className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${m.from_username === myUsername? 'bg-[#00f2ea] text-black ml-auto' : 'bg-zinc-800'}`}>
                {m.message}
              </div>
            ))}
          </div>
          <div className="p-3 border-t border-zinc-800 flex gap-2">
            <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder="Message..." className="flex-1 bg-zinc-900 border border-zinc-800 rounded-full px-4 py-2" />
            <button onClick={send} className="bg-[#00f2ea] text-black px-5 rounded-full font-bold">Send</button>
          </div>
        </>
      )}
    </div>
  );
}
