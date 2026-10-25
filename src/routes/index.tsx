import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./routes/index";
import Settings from "./routes/settings";
import { Toaster } from "sonner";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/foryou" element={<Index />} />
        <Route path="/offline" element={<div style={{padding:20}}>Offline - go back <a href="/">For You</a></div>} />
        <Route path="/history" element={<div style={{padding:20}}>History - go back <a href="/">For You</a></div>} />
        <Route path="/live" element={<div style={{padding:20, background:"black", color:"white", height:"100vh"}}>LIVE - camera here <a href="/" style={{color:"white", textDecoration:"underline"}}>Close</a></div>} />
        <Route path="*" element={<Index />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}

export default App;
