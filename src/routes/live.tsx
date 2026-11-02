import { lazy, Suspense, useCallback, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Radio, Sparkles, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const LiveStreamDialog = lazy(() =>
  import("@/components/LiveStreamDialog").then((mod) => ({ default: mod.LiveStreamDialog })),
);

type LiveSearch = { host?: string; name?: string };

export const Route = createFileRoute("/live")({
  validateSearch: (search: Record<string, unknown>): LiveSearch => ({
    ...(typeof search["host"] === "string" ? { host: search["host"] } : {}),
    ...(typeof search["name"] === "string" ? { name: search["name"] } : {}),
  }),
  head: () => ({
    meta: [
      { title: "LIVE — Coolerup" },
      {
        name: "description",
        content: "Go LIVE on Coolerup, invite guests on screen and send gifts in real time.",
      },
    ],
  }),
  component: LivePage,
});

/**
 * `/live` is the deep-linkable entry point into a LIVE room.
 *
 * `?host=<userId>&name=<username>` opens the room already watching that host,
 * which is what a shared "join my LIVE" link resolves to. Without params it
 * shows the Go LIVE hero and opens the create flow.
 */
function LivePage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { host, name } = Route.useSearch();
  const [open, setOpen] = useState(true);

  const close = useCallback(() => {
    setOpen(false);
    void navigate({ to: "/" });
  }, [navigate]);

  return (
    <main className="relative min-h-dvh overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,#fe2c5533,transparent_60%)]" />

      <div className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 text-center">
        <span className="mb-4 flex items-center gap-2 rounded-full bg-[#fe2c55]/15 px-3 py-1 text-xs font-extrabold text-[#fe2c55]">
          <Radio className="h-3.5 w-3.5" /> LIVE
        </span>
        <h1 className="text-3xl font-black leading-tight">
          Go LIVE and bring
          <br />
          your people on screen
        </h1>
        <p className="mt-3 max-w-xs text-sm text-white/60">
          Invite up to 4 guests, promote moderators, pin comments and let viewers send gifts — all
          in real time.
        </p>

        <div className="mt-8 grid w-full grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left">
            <Users className="mb-2 h-5 w-5 text-[#fe2c55]" />
            <p className="text-sm font-bold">Multi-guest</p>
            <p className="text-[11px] text-white/50">2×2 grid with per-person controls</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left">
            <Sparkles className="mb-2 h-5 w-5 text-yellow-400" />
            <p className="text-sm font-bold">Gifts & mods</p>
            <p className="text-[11px] text-white/50">Shields, mutes and pinned chat</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-8 w-full rounded-full bg-[#fe2c55] py-3.5 text-sm font-extrabold text-white transition active:scale-[0.99]"
        >
          {host ? "Open LIVE room" : "Start a LIVE"}
        </button>
        {!auth.user && (
          <p className="mt-3 text-[11px] text-white/40">You'll be asked to sign in first.</p>
        )}
      </div>

      <Suspense fallback={null}>
        <LiveStreamDialog
          open={open}
          onOpenChange={(next) => {
            if (!next) close();
            else setOpen(true);
          }}
          {...(auth.user?.id ? { userId: auth.user.id } : {})}
          username={auth.handle}
          {...(host ? { initialHost: { userId: host, username: name ?? "host" } } : {})}
          onRecord={() => undefined}
          onPhoto={() => undefined}
          onUpload={() => undefined}
        />
      </Suspense>
    </main>
  );
}
