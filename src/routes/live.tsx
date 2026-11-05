import { lazy, Suspense, useCallback, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Eye, Radio, Sparkles, Users } from "lucide-react";
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

/** Initials for the avatar bubble, so cards look like people not placeholders. */
function initials(name: string) {
  const clean = name.replace(/^@/, "").trim();
  return (clean.slice(0, 2) || "??").toUpperCase();
}

/** One card in the "Live now" list. */
function LiveCard({ host, onWatch }: { host: LiveHost; onWatch: (host: LiveHost) => void }) {
  return (
    <button
      type="button"
      onClick={() => onWatch(host)}
      className="group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-3 text-left transition hover:border-[#fe2c55]/60 hover:bg-white/10 active:scale-[0.99]"
    >
      <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#fe2c55] to-[#7a1bff] text-sm font-black text-white">
        {initials(host.username)}
        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-[#fe2c55] px-1.5 py-px text-[8px] font-black uppercase tracking-wider text-white ring-2 ring-black">
          Live
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">@{host.username}</span>
        <span className="block truncate text-xs text-white/50">{host.title}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white/80 group-hover:bg-[#fe2c55] group-hover:text-white">
        <Eye className="h-3.5 w-3.5" /> Watch
      </span>
    </button>
  );
}

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

        <section className="mt-6" data-testid="live-directory">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-white/40">
            <span className="relative flex h-2 w-2">
              {hosts.length > 0 && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#fe2c55] opacity-75" />
              )}
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  hosts.length > 0 ? "bg-[#fe2c55]" : "bg-white/30"
                }`}
              />
            </span>
            {hosts.length > 0 ? `${hosts.length} live now` : "Live now"}
          </div>

          {hosts.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/50">
              No one is live right now. Be the first — tap Go LIVE and your stream shows up here.
            </p>
          ) : (
            <div className="space-y-2">
              {hosts.map((live) => (
                <LiveCard key={live.userId} host={live} onWatch={watch} />
              ))}
            </div>
          )}
        </section>

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
