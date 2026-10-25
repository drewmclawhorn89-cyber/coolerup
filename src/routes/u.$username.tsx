import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

export default function UsernameProfile() {
  const { username: paramUsername } = useParams();
  const [username, setUsername] = useState(paramUsername || "drewmclawhorn3");
  const [videos, setVideos] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (paramUsername) setUsername(paramUsername);
    try {
      const all = JSON.parse(localStorage.getItem("videos") || "[]");
      const userVideos = all.filter((v:any) => v.username === paramUsername) || [];
      if (userVideos.length > 0) setVideos(userVideos);
      else setVideos(Array.from({ length: 12 }, (_, i) => ({ id: i, username, url: "", likes: Math.floor(Math.random()*500) })));
    } catch {}
  }, [paramUsername, username]);

  const openVideo = (v:any, idx:number) => {
    setSelected(v);
    setSelectedIndex(idx);
  };

  return (
    <div className="min-h-screen bg-white">
      {/* PROFILE HEADER */}
      <div className="p-4 flex gap-4">
        <div className="w-20 h-20 rounded-full bg-black text-white flex items-center justify-center text-2xl font-bold">{username[0]?.toUpperCase()}</div>
        <div className="flex-1">
          <h1 className="font-bold">@{username}</h1>
          <p className="text-xs text-gray-600 mt-1">{videos.length} videos</p>
        </div>
        <a href="/settings" style={{backgroundColor:"black", color:"white"}} className="rounded-full px-3 py-1 text-xs h-fit">Settings</a>
      </div>

      {/* GRID - FILLS FULL WIDTH - NO GRAY */}
      <div className="grid grid-cols-3 gap- w-screen">
        {videos.map((v, i) => (
          <div 
            key={i} 
            onClick={() => openVideo(v, i)}
            className="relative aspect-[3/4] w-full bg-black overflow-hidden cursor-pointer"
          >
            {/* FILL FULL - object-cover */}
            <div className="absolute inset-0 w-full h-full bg-black">
              {v.url ? (
                <video src={v.url} className="w-full h-full object-cover" muted playsInline />
              ) : (
                <div className="w-full h-full bg-black flex items-center justify-center">
                  <div className="w-full h-full bg-gradient-to-br from-zinc-800 to-black flex items-center justify-center">
                    <span className="text-white text-2xl">▶</span>
                  </div>
                </div>
              )}
            </div>
            <div className="absolute bottom-1 left-1 text-white text- font-bold">▶ {v.likes || Math.floor(Math.random()*500)}</div>
          </div>
        ))}
      </div>

      {/* FULL SCREEN VIEWER - FILLS FULL LIKE TIKTOK WHEN YOU TAP */}
      {selected && (
        <div style={{ position:"fixed", inset:0, zIndex:50, background:"black", width:"100vw", height:"100dvh", display:"flex", flexDirection:"column" }}>
          {/* Video fills full screen */}
          <div style={{ flex:1, position:"relative", width:"100%", height:"100%" }}>
            {selected.url ? (
              <video
                src={selected.url}
                style={{ position:"absolute", inset:0, width:"100%", height:"100%", objectFit:"cover" }}
                autoPlay
                loop
                playsInline
                controls={false}
              />
            ) : (
              <div style={{ position:"absolute", inset:0, width:"100%", height:"100%", background:"black", display:"flex", alignItems:"center", justifyContent:"center", color:"white" }}>
                FULL SCREEN VIDEO {selected.id}
              </div>
            )}

            {/* Top bar */}
            <div style={{ position:"absolute", top:0, left:0, right:0, padding:"16px", paddingTop:"50px", display:"flex", justifyContent:"space-between", background:"linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)", zIndex:10 }}>
              <button onClick={() => setSelected(null)} style={{ color:"white", fontSize:"20px" }}>←</button>
              <span style={{ color:"white", fontWeight:"bold" }}>@{username}</span>
              <span style={{ color:"white" }}>⋯</span>
            </div>

            {/* Bottom info - fills */}
            <div style={{ position:"absolute", bottom:"20px", left:"12px", right:"70px", color:"white", zIndex:10 }}>
              <div style={{ fontWeight:"bold", fontSize:"15px" }}>@{username}</div>
              <div style={{ fontSize:"13px", marginTop:"4px" }}>Video {selectedIndex + 1} of {videos.length}</div>
            </div>

            {/* Right buttons */}
            <div style={{ position:"absolute", right:"8px", bottom:"80px", display:"flex", flexDirection:"column", gap:"16px", zIndex:10 }}>
              <div style={{ width:"48px", height:"48px", borderRadius:"999px", background:"rgba(255,255,255,0.2)", display:"flex", alignItems:"center", justifyContent:"center" }}>❤️</div>
              <div style={{ width:"48px", height:"48px", borderRadius:"999px", background:"rgba(255,255,255,0.2)", display:"flex", alignItems:"center", justifyContent:"center" }}>💬</div>
              <div style={{ width:"48px", height:"48px", borderRadius:"999px", background:"rgba(255,255,255,0.2)", display:"flex", alignItems:"center", justifyContent:"center" }}>↗️</div>
            </div>

            {/* Swipe next/prev */}
            <button onClick={() => { const next = (selectedIndex + 1) % videos.length; setSelectedIndex(next); setSelected(videos[next]); }} style={{ position:"absolute", right:0, top:0, width:"50%", height:"100%", background:"transparent" }} />
            <button onClick={() => { const prev = (selectedIndex - 1 + videos.length) % videos.length; setSelectedIndex(prev); setSelected(videos[prev]); }} style={{ position:"absolute", left:0, top:0, width:"50%", height:"100%", background:"transparent" }} />
          </div>
        </div>
      )}

      {/* Bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 h- bg-white border-t flex justify-around items-center text-">
        <a href="/">Home</a>
        <a href="/profile">Profile</a>
      </div>
    </div>
  );
}
