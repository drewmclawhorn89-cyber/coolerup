import { useEffect, useState } from "react";

export default function Index() {
  const [videos] = useState([
    { id: 1, username: "drewmclawhorn3", caption: "Loop video - kitty" },
    { id: 2, username: "maya.moves", caption: "For You - 1332 videos" },
    { id: 3, username: "loop.user", caption: "TikTok fill style" },
  ]);
  const [current, setCurrent] = useState(0);
  const [muted, setMuted] = useState(true);

  // Apply theme
  useEffect(() => {
    const t = localStorage.getItem("settings:theme");
    if (t === "blue") {
      document.body.style.backgroundColor = "#2563EB";
    }
  }, []);

  const next = () => setCurrent((c) => (c + 1) % videos.length);
  const prev = () => setCurrent((c) => (c - 1 + videos.length) % videos.length);

  const v = videos[current];

  return (
    <div style={{ height: "100dvh", width: "100vw", background: "black", position: "relative", overflow: "hidden" }}>
      
      {/* FULL SCREEN VIDEO - FILLS LIKE TIKTOK */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          width: "100vw",
          height: "100dvh",
          background: "#111",
          objectFit: "cover",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontSize: "24px",
        }}
        onClick={next}
      >
        VIDEO {v.id} - TAP TO NEXT
      </div>

      {/* TOP TABS - like 2nd pic */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, paddingTop: "50px", paddingBottom: "10px", paddingLeft: "12px", paddingRight: "12px", background: "linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)", zIndex: 10, display: "flex", gap: "16px", fontWeight: "bold", fontSize: "15px", color: "rgba(255,255,255,0.6)", overflowX: "auto" }}>
        <span>LIVE</span>
        <span>STEM</span>
        <span>Community</span>
        <span>Following</span>
        <span style={{ color: "white" }}>For You <div style={{ height: "3px", width: "24px", background: "white", borderRadius: "999px", margin: "4px auto 0" }} /></span>
      </div>

      {/* BOTTOM LEFT - username like @drewmclawhorn3 */}
      <div style={{ position: "absolute", bottom: "90px", left: "12px", right: "70px", zIndex: 10, color: "white" }}>
        <div style={{ fontWeight: "bold", fontSize: "15px" }}>@{v.username}</div>
        <div style={{ fontSize: "13px", marginTop: "4px" }}>{v.caption}</div>
      </div>

      {/* RIGHT BAR - D, heart 6, comment 0, share 0 */}
      <div style={{ position: "absolute", right: "8px", bottom: "110px", zIndex: 10, display: "flex", flexDirection: "column", gap: "18px", alignItems: "center" }}>
        <button onClick={() => setMuted(!muted)} style={{ height: "36px", width: "36px", borderRadius: "999px", background: "rgba(255,255,255,0.2)", color: "white" }}>{muted ? "🔇" : "🔊"}</button>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ height: "48px", width: "48px", borderRadius: "999px", background: "#ff2d55", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: "bold" }}>D</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ height: "48px", width: "48px", borderRadius: "999px", background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>❤️</div>
          <span style={{ color: "white", fontSize: "12px", fontWeight: "bold", marginTop: "2px" }}>6</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ height: "48px", width: "48px", borderRadius: "999px", background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>💬</div>
          <span style={{ color: "white", fontSize: "12px", fontWeight: "bold", marginTop: "2px" }}>0</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ height: "48px", width: "48px", borderRadius: "999px", background: "rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>↗️</div>
          <span style={{ color: "white", fontSize: "12px", fontWeight: "bold", marginTop: "2px" }}>0</span>
        </div>
      </div>

      {/* BOTTOM NAV - Home Explore Following + Inbox You Profile */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, height: "60px", background: "black", borderTop: "1px solid rgba(255,255,255,0.1)", display: "flex", justifyContent: "space-around", alignItems: "center", zIndex: 20, color: "white" }}>
        <a href="/" style={{ color: "#ff2d55", textAlign: "center", fontSize: "10px" }}>⌂<br/>Home</a>
        <a href="/explore" style={{ color: "rgba(255,255,255,0.6)", textAlign: "center", fontSize: "10px" }}>👥<br/>Explore</a>
        <a href="/following" style={{ color: "rgba(255,255,255,0.6)", textAlign: "center", fontSize: "10px" }}>👥<br/>Following</a>
        <a href="/live" style={{ background: "#ff2d55", height: "40px", width: "48px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px" }}>+</a>
        <a href="/inbox" style={{ color: "rgba(255,255,255,0.6)", textAlign: "center", fontSize: "10px" }}>🔔<br/>Inbox</a>
        <a href="/profile" style={{ color: "rgba(255,255,255,0.6)", textAlign: "center", fontSize: "10px" }}>👤<br/>Profile</a>
      </div>

      {/* Tap areas for next/prev */}
      <button onClick={prev} style={{ position: "absolute", top: "50%", left: "0", zIndex: 5, width: "50%", height: "60%", background: "transparent" }} />
      <button onClick={next} style={{ position: "absolute", top: "50%", right: "0", zIndex: 5, width: "50%", height: "60%", background: "transparent" }} />
    </div>
  );
}
