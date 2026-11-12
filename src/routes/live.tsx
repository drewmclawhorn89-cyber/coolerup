import { lazy, Suspense, useCallback, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Radio, Sparkles, Users } from "lucide-react";
import { LiveNowList } from "@/components/LiveNowList";
import { useAuth } from "@/hooks/useAuth";
import { useLiveDirectory, type LiveHost } from "@/lib/liveDirectory";

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
        content:
          "Watch everyone who is live on Coolerup right now, or go LIVE yourself with guests, gifts and mods.",
      },
    ],
  }),
  component: LivePage,
});

/**
 * `/live` is both the LIVE directory and the deep-linkable entry point into a room.
 *
 * - No params: lists everyone currently broadcasting (via the shared presence
 *   directory) and offers the Go LIVE hero underneath.
 * - `?host=<userId>&name=<username>`: opens that room straight away, which is
 *   what a shared "join my LIVE" link resolves to.
 */
function LivePage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { host, name } = Route.useSearch();
  const [open, setOpen] = useState(Boolean(host));
  const [watching, setWatching] = useState<LiveHost | null>(null);

  const { hosts } = useLiveDirectory({ key: auth.user?.id ?? null });

  const deepHost = host ? { userId: host, username: name ?? "host" } : null;
  const initialHost = watching ?? deepHost ?? undefined;

  const watch = useCallback((next: LiveHost) => {
    setWatching(next);
    setOpen(true);
  }, []);

  const startLive = useCallback(() => {
    setWatching(null);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setWatching(null);
    if (host) void navigate({ to: "/live", search: {} });
  }, [host, navigate]);

  return (
    <main className="relative min-h-dvh overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,#fe2c5533,transparent_60%)]" />

      <div className="relative mx-auto w-full max-w-md px-5 pb-24 pt-8">
        <header className="flex items-center justify-between">
          <span className="flex items-center gap-2 rounded-full bg-[#fe2c55]/15 px-3 py-1 text-xs font-extrabold text-[#fe2c55]">
            <Radio className="h-3.5 w-3.5" /> LIVE
          </span>
          <button
            type="button"
            onClick={startLive}
            className="rounded-full bg-[#fe2c55] px-4 py-2 text-xs font-extrabold text-white transition active:scale-[0.98]"
          >
            Go LIVE
          </button>
        </header>

        <LiveNowList hosts={hosts} onWatch={watch} onGoLive={startLive} className="-mx-5 mt-2 px-5" />

        <section className="mt-10 text-center">
          <h1 className="text-2xl font-black leading-tight">
            Go LIVE and bring
            <br />
            your people on screen
          </h1>
          <p className="mx-auto mt-3 max-w-xs text-sm text-white/60">
            Invite up to 4 guests, promote moderators, pin comments and let viewers send gifts — all
            in real time.
          </p>

          <div className="mt-6 grid w-full grid-cols-2 gap-3 text-left">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <Users className="mb-2 h-5 w-5 text-[#fe2c55]" />
              <p className="text-sm font-bold">Multi-guest</p>
              <p className="text-[11px] text-white/50">2×2 grid with per-person controls</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <Sparkles className="mb-2 h-5 w-5 text-yellow-400" />
              <p className="text-sm font-bold">Gifts &amp; mods</p>
              <p className="text-[11px] text-white/50">Shields, mutes and pinned chat</p>
            </div>
          </div>

          <button
            type="button"
            onClick={startLive}
            className="mt-6 w-full rounded-full bg-[#fe2c55] py-3.5 text-sm font-extrabold text-white transition active:scale-[0.99]"
          >
            Start a LIVE
          </button>
          {!auth.user && (
            <p className="mt-3 text-[11px] text-white/40">You'll be asked to sign in first.</p>
          )}
        </section>
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
          {...(initialHost ? { initialHost } : {})}
          onRecord={() => undefined}
          onPhoto={() => undefined}
          onUpload={() => undefined}
        />
      </Suspense>
    </main>
  );
}
