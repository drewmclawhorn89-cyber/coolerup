import { useState, useEffect } from "react";

type Message = { id: string; username: string; text: string; time: string; unread?: boolean };

export default function Messages() {
  const [tab, setTab] = useState<"all" | "requests" | "settings">("all");
  const [privacy, setPrivacy] = useState(localStorage.getItem("messagePrivacy") || "everyone");
  const [filter, setFilter] = useState(localStorage.getItem("messageFilter") || "all");
  const [allowDM, setAllowDM] = useState(localStorage.getItem("allowDM") !== "false");
  const [readReceipts, setReadReceipts] = useState(localStorage.getItem("readReceipts") !== "false");
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem("messages");
    if (saved) setMessages(JSON.parse(saved));
    else setMessages([
      { id: "1", username: "loop_team", text: "Welcome to Loop! 💜", time: "now", unread: true },
      { id: "2", username: "alex", text: "Yo check this video", time: "2m" },
    ]);
  }, []);

  const savePrivacy = (v: string) => { setPrivacy(v); localStorage.setItem("messagePrivacy", v); };
  const saveFilter = (v: string) => { setFilter(v); localStorage.setItem("messageFilter", v); };

  return (
    <div className="min-h-screen bg-white max-w- mx-auto">
      {/* TOP TABS LIKE TIKTOK */}
      <div className="flex justify-around border-b py-3 font-bold text- sticky top-0 bg-white z-10">
        <button onClick={()=>setTab("all")} className={`${tab==="all"?"text-black border-b-2 border-black":"text-gray-400"} pb-1`}>All</button>
        <button onClick={()=>setTab("requests")} className={`${tab==="requests"?"text-black border-b-2 border-black":"text-gray-400"} pb-1`}>Requests</button>
        <button onClick={()=>setTab("settings")} className={`${tab==="settings"?"text-black border-b-2 border-black":"text-gray-400"} pb-1`}>Settings</button>
      </div>

      {/* ALL MESSAGES */}
      {tab === "all" && (
        <div className="divide-y">
          {messages.map(m => (
            <div key={m.id} className="flex items-center gap-3 p-4 hover:bg-gray-50">
              <div className="h-12 w-12 rounded-full bg-black text-white flex items-center justify-center font-bold">{m.username[0].toUpperCase()}</div>
              <div className="flex-1">
                <div className="font-bold text- flex items-center gap-2">{m.username} {m.unread && <span className="h-2 w-2 bg-[#fe2c55] rounded-full" />}</div>
                <div className="text-gray-500 text-">{m.text}</div>
              </div>
              <div className="text-gray-400 text-">{m.time}</div>
            </div>
          ))}
          {messages.length===0 && <div className="p-10 text-center text-gray-400">No messages yet</div>}
        </div>
      )}

      {/* REQUESTS */}
      {tab === "requests" && (
        <div className="p-4">
          <h2 className="font-bold mb-2">Message requests</h2>
          <p className="text-gray-500 text- mb-4">People who can message you based on your settings will appear here</p>
          <div className="flex gap-2 mb-4">
            {["all","filtered"].map(f=>(
              <button key={f} onClick={()=>saveFilter(f)} className={`px-4 py-2 rounded-full text- font-bold ${filter===f?"bg-black text-white":"bg-gray-100"}`}>{f}</button>
            ))}
          </div>
          <div className="text-center text-gray-400 mt-20">No requests</div>
        </div>
      )}

      {/* SETTINGS - DIFFERENT MESSAGE SETTINGS LIKE TIKTOK */}
      {tab === "settings" && (
        <div className="p-4">
          <h2 className="font-bold text- mb-1">Message settings</h2>
          <p className="text-gray-500 text- mb-6">Manage how you receive messages</p>

          <div className="mb-6">
            <p className="font-bold text- mb-3">Who can send you direct messages</p>
            {[
              {id:"everyone", label:"Everyone", desc:"Anyone"},
              {id:"friends", label:"Friends", desc:"People you follow back"},
              {id:"mutuals", label:"Friends of friends", desc:"Friends + their friends"},
              {id:"noone", label:"No one", desc:"No one can DM you"},
            ].map(o=>(
              <button key={o.id} onClick={()=>savePrivacy(o.id)} className={`w-full flex justify-between items-center p-3 rounded-xl border mb-2 text-left ${privacy===o.id?"bg-black text-white border-black":"bg-white"}`}>
                <div>
                  <div className="font-semibold text-">{o.label}</div>
                  <div className={`text- ${privacy===o.id?"text-gray-300":"text-gray-500"}`}>{o.desc}</div>
                </div>
                <div className={`h-5 w-5 rounded-full border-2 flex items-center justify-center ${privacy===o.id?"border-white":"border-gray-300"}`}>{privacy===o.id && <div className="h-2 w-2 bg-white rounded-full" />}</div>
              </button>
            ))}
          </div>

          <div className="space-y-4 border-t pt-4">
            <div className="flex justify-between items-center">
              <div><div className="font-medium text-">Allow direct messages</div><div className="text-gray-500 text-">From people you allow</div></div>
              <button onClick={()=>{const v=!allowDM; setAllowDM(v); localStorage.setItem("allowDM", String(v));}} className={`h-7 w-12 rounded-full p-1 ${allowDM?"bg-black":"bg-gray-300"}`}><div className={`h-5 w-5 bg-white rounded-full transition ${allowDM?"translate-x-5":""}`} /></button>
            </div>
            <div className="flex justify-between items-center">
              <div><div className="font-medium text-">Read receipts</div><div className="text-gray-500 text-">Show when read</div></div>
              <button onClick={()=>{const v=!readReceipts; setReadReceipts(v); localStorage.setItem("readReceipts", String(v));}} className={`h-7 w-12 rounded-full p-1 ${readReceipts?"bg-black":"bg-gray-300"}`}><div className={`h-5 w-5 bg-white rounded-full transition ${readReceipts?"translate-x-5":""}`} /></button>
            </div>
            <div className="flex justify-between items-center">
              <div><div className="font-medium text-">Filter spam</div><div className="text-gray-500 text-">Auto-filter suspicious</div></div>
              <button className="h-7 w-12 rounded-full p-1 bg-black"><div className="h-5 w-5 bg-white rounded-full translate-x-5" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
