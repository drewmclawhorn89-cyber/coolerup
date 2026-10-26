import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCall } from "@/lib/calls";
import { toast } from "sonner";

export const Route = createFileRoute("/messages")({
  component: Messages,
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

  // SETTINGS - DIFFERENT LIKE TIKTOK
  const [tab, setTab] = useState<"chat" | "settings">("chat");
  const [privacy, setPrivacy] = useState(localStorage.getItem("messagePrivacy") || "everyone");
  const [filter, setFilter] = useState(localStorage.getItem("messageFilter") || "all");
  const [allowDM, setAllowDM] = useState(localStorage.getItem("allowDM") !== "false");
  const [readReceipts, setReadReceipts] = useState(localStorage.getItem("readReceipts") !== "false");

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
    if (!text.trim() || !toUser) { toast("Enter username and message"); return; }
    await supabase.from("messages").insert({ from_username: me, to_username: toUser, message: text });
    setText("");
  };

  const savePrivacy = (v: string) => { setPrivacy(v); localStorage.setItem("messagePrivacy", v); toast("Saved: " + v); };
  const saveFilter = (v: string) => { setFilter(v); localStorage.setItem("messageFilter", v); };

  if (tab === "settings") {
    return (
      <div className="min-h-screen bg-white max-w- mx-auto">
        <div className="flex items-center gap-3 p-4 border-b">
          <button onClick={()=>setTab("chat")}><ArrowLeft className="h-6 w-6" /></button>
          <h1 className="font-bold text-">Message Settings</h1>
        </div>
        <div className="p-4">
          <h2 className="font-bold text- mb-3">Who can send you direct messages</h2>
          <div className="space-y-2 mb-6">
            {[
              { id: "everyone", name: "Everyone", desc: "Anyone on Loop" },
              { id: "friends", name: "Friends", desc: "Only people you follow back" },
              { id: "mutuals", name: "Friends of friends", desc: "Friends + their friends" },
              { id: "noone", name: "No one", desc: "Turn off DMs" },
            ].map(o=>(
              <button key={o.id} onClick={()=>savePrivacy(o.id)} className={`w-full text-left p-4 rounded-2xl border-2 flex justify-between items-center ${privacy===o.id?"bg-black text-white border-black":"bg-gray-50 border-gray-100"}`}>
                <div><div className="font-bold text-">{o.name}</div><div className="text- opacity-70">{o.desc}</div></div>
                <div className={`h-6 w-6 rounded-full border-2 flex items-center justify-center ${privacy===o.id?"border-white":"border-gray-300"}`}>{privacy===o.id && <div className="h-3 w-3 bg-white rounded-full" />}</div>
              </button>
            ))}
          </div>

          <h2 className="font-bold text- mb-3">Message requests filter</h2>
          <div className="flex gap-2 mb-6">
            {["all","filtered","off"].map(id=>(
              <button key={id} onClick={()=>saveFilter(id)} className={`flex-1 py-3 rounded-full font-bold text- ${filter===id?"bg-black text-white":"bg-gray-100"}`}>{id}</button>
            ))}
          </div>

          <div className="border-t divide-y">
            <div className="flex justify-between items-center py-4">
              <div><div className="font-semibold text-">Allow direct messages</div><div className="text- text-gray-500">Let others message you</div></div>
              <button onClick={()=>{const v=!allowDM; setAllowDM(v); localStorage.setItem("allowDM", String(v));}} className={`h-8 w-14 rounded-full p-1 ${allowDM?"bg-black":"bg-gray-300"}`}><div className={`h-6 w-6 bg-white rounded-full transition ${allowDM?"translate-x-6":""}`} /></button>
            </div>
            <div className="flex justify-between items-center py-4">
              <div><div className="font-semibold text-">Read receipts</div><div className="text- text-gray-500">Show when read</div></div>
              <button onClick={()=>{const v=!readReceipts; setReadReceipts(v); localStorage.setItem("readReceipts", String(v));}} className={`h-8 w-14 rounded-full p-1 ${readReceipts?"bg-black":"bg-gray-300"}`}><div className={`h-6 w-6 bg-white rounded-full transition ${readReceipts?"translate-x-6":""}`} /></button>
            </div>
            <div className="flex justify-between items-center py-4">
              <div><div className="font-semibold text-">Allow calls</div><div className="text- text-gray-500">Let others call you</div></div>
              <button className="h-8 w-14 rounded-full p-1 bg-black"><div className="h-6 w-6 bg-white rounded-full translate-x-6" /></button>
            </div>
          </div>

          <Button onClick={()=>setTab("chat")} className="w-full mt-6 bg-black text-white rounded-full py-6 font-bold">Back to Messages</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white max-w- mx-auto flex flex-col">
      <div className="flex items-center justify-between p-3 border-b sticky top-0 bg-white z-10">
        <div className="flex items-center gap-3">
          <Link to="/"><ArrowLeft className="h-6 w-6" /></Link>
          <h1 className="font-bold">Messages</h1>
          <span className="text- bg-gray-100 px-2 py-1 rounded-full">{privacy}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={()=>setTab("settings")} className="text- font-bold border-2 border-black px-3 py-1.5 rounded-full">Settings</button>
          <button onClick={()=>toUser && startCall(toUser)} className="h-9 w-9 bg-black text-white rounded-full flex items-center justify-center"><Phone className="h-5 w-5" /></button>
        </div>
      </div>

      <div className="p-3 flex gap-2 border-b bg-gray-50">
        <input value={toUser} onChange={e=>setToUser(e.target.value)} placeholder="Username to chat..." className="flex-1 border rounded-full px-4 py-2.5 text- bg-white" />
        <Button onClick={()=>toUser && startCall(toUser)} className="rounded-full bg-black text-white h-11 w-11 p-0"><Phone className="h-5 w-5" /></Button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-white">
        {msgs.length===0 && <div className="text-center text-gray-400 text- mt-10">No messages yet.<br/>Enter username above to start chatting.<br/><br/>Privacy: {privacy} can DM you</div>}
        {msgs.map(m=>(
          <div key={m.id} className={`max-w-[75%] p-3 rounded-2xl text- ${m.from_username===me?"bg-black text-white ml-auto rounded-br-sm":"bg-gray-100 rounded-bl-sm"}`}>{m.message}</div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="p-3 border-t flex gap-2 sticky bottom-0 bg-white">
        <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Message..." className="flex-1 border rounded-full px-4 py-3 text-" />
        <Button onClick={send} className="rounded-full bg-black text-white px-6 h-12">Send</Button>
      </div>
    </div>
  );
}
