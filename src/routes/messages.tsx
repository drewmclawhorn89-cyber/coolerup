import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export default function Messages() {
  const myUsername = "drew";
  const [toUser, setToUser] = useState("");
  const [text, setText] = useState("");
  const [msgs, setMsgs] = useState<any[]>([]);
  const [inbox, setInbox] = useState<string[]>([]);

  useEffect(() => {
    const urlUser = new URLSearchParams(window.location.search).get("user");
    if(urlUser) setToUser(urlUser);
    const load = async () => {
      const { data } = await supabase.from("direct_messages").select("*").or(`from_username.eq.${myUsername},to_username.eq.${myUsername}`).order("created_at",{ascending:true});
      if(data){ 
        setMsgs(data); 
        const s=new Set<string>(); 
        data.forEach((m:any)=>{ 
          if(m.from_username!==myUsername) s.add(m.from_username); 
          if(m.to_username!==myUsername) s.add(m.to_username); 
        }); 
        setInbox([...s]); 
      }
    };
    load();
  }, []);

  const send = async () => {
    if(!text.trim()||!toUser) return;
    await supabase.from("direct_messages").insert({ from_username: myUsername, to_username: toUser, message: text });
    setMsgs([...msgs, { from_username: myUsername, to_username: toUser, message: text }]);
    setText("");
    if(!inbox.includes(toUser)) setInbox([...inbox, toUser]);
  };

  const convo = msgs.filter((m:any)=> (m.from_username===toUser&&m.to_username===myUsername) || (m.from_username===myUsername&&m.to_username===toUser));

  return (
    <div className="min-h-screen bg-black text-white p-4 pb-24 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold mb-4">Messages</h1>
      <input value={toUser} onChange={e=>setToUser(e.target.value)} placeholder="To: username" className="w-full bg-zinc-900 border border-zinc-800 rounded-full px-4 py-2 mb-3" />
      <div className="flex gap-2 mb-3 overflow-x-auto">
        {inbox.map((u:any)=><button key={u} onClick={()=>setToUser(u)} className={`px-3 py-1 rounded-full text-sm ${toUser===u?'bg-[#00f2ea] text-black':'bg-zinc-800'}`}>@{u}</button>)}
      </div>
      <div className="h- overflow-y-auto bg-zinc-900/50 rounded-xl p-3 space-y-2 mb-3 border border-zinc-800">
        {convo.length===0?<p className="text-zinc-500 text-center mt-10">No messages yet. Say hi!</p>:convo.map((m:any,i:number)=><div key={i} className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${m.from_username===myUsername?'bg-[#00f2ea] text-black ml-auto':'bg-zinc-800'}`}>{m.message}</div>)}
      </div>
      <div className="flex gap-2">
        <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="Type a message..." className="flex-1 bg-zinc-900 border border-zinc-800 rounded-full px-4 py-2" />
        <button onClick={send} className="bg-[#00f2ea] text-black px-6 rounded-full font-bold">Send</button>
      </div>
    </div>
  );
}
