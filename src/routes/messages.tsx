import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Phone } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCall } from "@/lib/calls";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/messages")({
  component: Messages,
  head: () => ({
    meta: [
      { title: "Messages - Loop." },
      { name: "description", content: "Chat with creators on Loop." },
    ],
  }),
});

type Msg = { id: string; from_username: string; to_username: string; message: string; created_at: string };

function Messages() {
  const auth = useAuth();
  const { startCall } = useCall();
  const me = auth.handle;
  const [toUser, setToUser] = useState("");
  const [text, setText] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  // MESSAGE SETTINGS - DIFFERENT LIKE TIKTOK
  const [tab, setTab] = useState<"chat" | "settings">("chat");
  const [privacy, setPrivacy] = useState(localStorage.getItem("messagePrivacy") || "everyone");
  const [allowDM, setAllowDM] = useState(localStorage.getItem("allowDM") !== "false");
  const [readReceipts, setReadReceipts] = useState(localStorage.getItem("readReceipts") !== "false");
  const [filter, setFilter] = useState(localStorage.getItem("messageFilter") || "all");

  const savePrivacy = (v: string) => { setPrivacy(v); localStorage.setItem("messagePrivacy", v); toast("Saved"); };
  const saveFilter = (v: string) => { setFilter(v); localStorage.setItem("messageFilter", v); };

  useEffect(() => {
    if (!me || !toUser) return;
    supabase.from("messages").select("*").or(`and(from_username.eq.${me},to_username.eq.${toUser}),and(from_username.eq.${toUser},to_username.eq.${me})`).order("created_at").then(({ data }) => { if (data) setMsgs(data as any); });
    const ch = supabase.channel("msgs").on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => {
      const m = p.new as Msg;
      if ((m.from_username===me && m.to_username===toUser) || (m.from_username===toUser && m.to_username===me)) setMsgs(s=>[...s, m]);
    }).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [me, toUser]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const send = async () => {
    if (!text.trim() || !toUser) return;
    await supabase.from("messages").insert({ from_username: me, to_username: toUser, message: text });
    setText("");
  };

  if (tab === "settings") {
    return (
      <div className="min-h-screen bg-white max-w- mx-auto p-4 pb-20">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={()=>setTab("chat")}><ArrowLeft className="h-6 w-6" /></button>
          <h1 className="text-xl font-bold">Message Settings</h1>
        </div>

        <h2 className="font-bold text- mb-3">Who can send you direct messages</h2>
        <div className="flex flex-col gap-2 mb-6">
          {[
            { id: "everyone", label: "Everyone", desc: "Anyone on Loop" },
            { id: "friends", label: "Friends", desc: "People you follow back" },
            { id: "mutuals", label: "Friends of friends", desc: "Friends + their friends" },
            { id: "noone", label: "No one", desc: "No DMs" },
          ].map(o=>(
            <button key={o.id} onClick={()=>savePrivacy(o.id)} className={`flex justify-between p-3 rounded-xl border text-left ${privacy===o.id?"bg-black text-white":"bg-gray-50"}`}>
              <div><div className="font-semibold text-">{o.label}</div><div className="text- opacity-70">{o.desc}</div></div>
              <div className={`h-5 w-5 rounded-full border-2 flex items-center justify-center ${privacy===o.id?"border-white":"border-gray-300"}`}>{privacy===o.id && <div className="h-2 w-2 bg-white rounded-full" />}</div>
            </button>
          ))}
        </div>

        <h2 className="font-bold text- mb-3">Message requests filter</h2>
        <div className="flex gap-2 mb-6">
          {["all","filtered"].map(id=>(
            <button key={id} onClick={()=>saveFilter(id)} className={`flex-1 py-2 rounded-full font-bold ${filter===id?"bg-black text-white":"bg-gray-100"}`}>{id}</button>
          ))}
        </div>

        <div className="border-t pt-4 space-y-4">
          <div className="flex justify-between items-center">
            <div><div className="font-medium text-">Allow direct messages</div><div className="text- text-gray-500">Let others message you</div></div>
            <button onClick={()=>{const v=!allowDM; setAllowDM(v); localStorage.setItem("allowDM", String(v));}} className={`h-7 w-12 rounded-full p-1 ${allowDM?"bg-black":"bg-gray-300"}`}><div className={`h-5 w-5 bg-white rounded-full transition ${allowDM?"translate-x-5":""}`} /></button>
          </div>
          <div className="flex justify-between items-center">
            <div><div className="font-medium text-">Read receipts</div><div className="text- text-gray-500">Show when read</div></div>
            <button onClick={()=>{const v=!readReceipts; setReadReceipts(v); localStorage.setItem("readReceipts", String(v));}} className={`h-7 w-12 rounded-full p-1 ${readReceipts?"bg-black":"bg-gray-300"}`}><div className={`h-5 w-5 bg-white rounded-full transition ${readReceipts?"translate-x-5":""}`} /></button>
          </div>
        </div>

        <Button onClick={()=>setTab("chat")} className="w-full mt-8 bg-black text-white rounded-full py-6 font-bold">Back to Messages</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white max-w- mx-auto flex flex-col">
      <div className="flex items-center justify-between p-3 border-b sticky top-0 bg-white z-10">
        <div className="flex items-center gap-3">
          <Link to="/"><ArrowLeft className="h-6 w-6" /></Link>
          <h1 className="font-bold">Messages</h1>
        </div>
        <button onClick={()=>setTab("settings")} className="text- font-bold border px-3 py-1 rounded-full">Settings</button>
      </div>

      <div className="p-3 flex gap-2 border-b">
        <input value={toUser} onChange={e=>setToUser(e.target.value)} placeholder="Username to chat" className="flex-1 border rounded-full px-4 py-2 text-" />
        <button onClick={()=>startCall(toUser)} className="h-10 w-10 bg-black text-white rounded-full flex items-center justify-center"><Phone className="h-5 w-5" /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {msgs.map(m=>(
          <div key={m.id} className={`max-w-[75%] p-3 rounded-2xl text- ${m.from_username===me?"bg-black text-white ml-auto":"bg-gray-100"}`}>{m.message}</div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="p-3 border-t flex gap-2 sticky bottom-0 bg-white">
        <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Message..." className="flex-1 border rounded-full px-4 py-3 text-" />
        <Button onClick={send} className="rounded-full bg-black text-white px-6">Send</Button>
      </div>
    </div>
  );
}
