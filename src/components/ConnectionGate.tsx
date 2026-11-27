import { useEffect, useState, type ReactNode } from "react";

const key = "coolerup:disconnected-at";
const grace = 5 * 60_000;

export function ConnectionGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"online" | "cached" | "expired">("online");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let since = 0;
    try {
      since = Number(sessionStorage.getItem(key)) || 0;
    } catch {
      /* Storage is optional in private browsing. */
    }
    function sync() {
      clearTimeout(timer);
      if (navigator.onLine) {
        since = 0;
        setState("online");
        try {
          sessionStorage.removeItem(key);
        } catch {
          /* Storage is optional in private browsing. */
        }
      } else {
        if (!since || since > Date.now()) since = Date.now();
        try {
          sessionStorage.setItem(key, String(since));
        } catch {
          /* Storage is optional in private browsing. */
        }
        const left = since + grace - Date.now();
        setState(left > 0 ? "cached" : "expired");
        if (left > 0) timer = setTimeout(sync, left);
      }
    }
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  if (state === "expired")
    return (
      <main className="grid h-full place-content-center gap-4 bg-black text-center text-white">
        <h1>You’re offline</h1>
        <p>Reconnect to continue watching.</p>
        <button className="rounded-full border px-4 py-2" onClick={() => window.location.reload()}>
          Retry
        </button>
      </main>
    );
  return (
    <>
      {state === "cached" && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-50 bg-black/80 p-2 text-center text-xs text-white"
        >
          Connection lost. Cached content is available for five minutes.
        </div>
      )}
      {children}
    </>
  );
}
