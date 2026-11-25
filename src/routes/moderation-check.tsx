import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Check, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { moderationAvailable, myStrikeStatus } from "@/lib/autoBans";
import { amIAdmin } from "@/lib/moderation";
import { inspectMedia, judgePredictions } from "@/lib/nsfw";

/**
 * Moderation self-check.
 *
 * "Auto bans aren't working" is almost always one of four things: the SQL was
 * never run, the tester is an admin (admins are immune), the NSFW model failed
 * to load on this device, or the decision rule is wrong. This page answers all
 * four in one screen so nobody has to guess.
 */

export const Route = createFileRoute("/moderation-check")({
  head: () => ({ meta: [{ title: "Moderation check · Coolerup" }] }),
  component: ModerationCheck,
});

type State = "pending" | "ok" | "fail";

type Check = {
  key: string;
  label: string;
  state: State;
  detail: string;
};

function Row({ check }: { check: Check }) {
  const Icon = check.state === "ok" ? Check : check.state === "fail" ? X : Loader2;
  const color =
    check.state === "ok"
      ? "text-emerald-400"
      : check.state === "fail"
        ? "text-[#FE2C55]"
        : "text-zinc-400";
  return (
    <div className="flex gap-3 border-b border-zinc-800 py-3 last:border-0">
      <Icon
        size={18}
        className={`mt-0.5 shrink-0 ${color} ${check.state === "pending" ? "animate-spin" : ""}`}
      />
      <div className="min-w-0">
        <p className="text-sm font-medium text-white">{check.label}</p>
        <p className="mt-0.5 break-words text-xs text-zinc-400">{check.detail}</p>
      </div>
    </div>
  );
}

function ModerationCheck() {
  const auth = useAuth();
  const [checks, setChecks] = useState<Check[]>([]);

  const set = useCallback((key: string, patch: Partial<Check>) => {
    setChecks((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  }, []);

  useEffect(() => {
    setChecks([
      {
        key: "sql",
        label: "Database functions installed",
        state: "pending",
        detail: "Calling my_strike_status()…",
      },
      { key: "admin", label: "Your account", state: "pending", detail: "Checking role…" },
      {
        key: "model",
        label: "NSFW model on this device",
        state: "pending",
        detail: "Loading TensorFlow + weights…",
      },
      { key: "rule", label: "Decision rule", state: "pending", detail: "Checking thresholds…" },
    ]);

    let cancelled = false;

    void (async () => {
      const ready = await moderationAvailable();
      if (cancelled) return;
      set("sql", {
        state: ready ? "ok" : "fail",
        detail: ready
          ? "auto_moderate, my_strike_status and friends are live."
          : "MISSING. Run supabase/sql-editor-auto-bans.sql in the Supabase SQL editor. Nothing can ban until you do.",
      });

      const admin = await amIAdmin();
      if (cancelled) return;
      set("admin", {
        state: "ok",
        detail: admin
          ? "You are an ADMIN — admins are immune to auto-bans by design. Test with a normal account or you will never see a popup."
          : `Signed in as @${auth.handle ?? "?"} (not an admin) — auto-bans will apply to you.`,
      });

      if (ready) {
        try {
          const s = await myStrikeStatus();
          if (!cancelled) {
            set("admin", {
              state: "ok",
              detail: `Signed in as @${auth.handle ?? "?"}${admin ? " (ADMIN — immune, test with a normal account)" : ""}. Strikes: ${s.strike_count}, permanent: ${s.is_permanent ? "yes" : "no"}.`,
            });
          }
        } catch {
          /* status is a nicety */
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = 224;
      canvas.height = 224;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const g = ctx.createLinearGradient(0, 0, 224, 224);
        g.addColorStop(0, "#2b6cb0");
        g.addColorStop(1, "#f6e05e");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 224, 224);
      }
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      const started = performance.now();
      const verdict = blob ? await inspectMedia(blob) : null;
      if (cancelled) return;
      set("model", {
        state: verdict ? "ok" : "fail",
        detail: verdict
          ? `Loaded and classified a test image in ${Math.round(performance.now() - started)}ms (score ${verdict.score.toFixed(3)}, ${verdict.frames} frame(s)).`
          : "COULD NOT LOAD. This device cannot run the classifier, so video/photo checks are skipped. Try Chrome, or the installed Android app.",
      });

      const porn = judgePredictions(
        [
          { className: "Porn", probability: 0.9 },
          { className: "Hentai", probability: 0.01 },
          { className: "Sexy", probability: 0.05 },
          { className: "Neutral", probability: 0.04 },
          { className: "Drawing", probability: 0 },
        ],
        6,
      );
      const swim = judgePredictions(
        [
          { className: "Porn", probability: 0.05 },
          { className: "Hentai", probability: 0.01 },
          { className: "Sexy", probability: 0.9 },
          { className: "Neutral", probability: 0.04 },
          { className: "Drawing", probability: 0 },
        ],
        1,
      );
      set("rule", {
        state: porn.explicit && !swim.explicit ? "ok" : "fail",
        detail: `Porn 0.90 → ${porn.explicit ? "ban" : "allow"}; swimwear 0.90 → ${swim.explicit ? "ban" : "allow"}. Expected: ban, allow.`,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [auth.handle, set]);

  const failing = checks.filter((c) => c.state === "fail").length;

  return (
    <div className="min-h-dvh bg-black text-white">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-zinc-800 bg-black px-4 py-3">
        <Link to="/settings" className="text-zinc-300">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-base font-semibold">Moderation check</h1>
      </header>

      <main className="mx-auto max-w-xl px-4 py-4">
        <p className="mb-4 text-sm text-zinc-400">
          Four things have to be true before a naked video gets removed and the poster banned. This
          page checks all of them on the device you are using right now.
        </p>

        <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-4">
          {checks.map((c) => (
            <Row key={c.key} check={c} />
          ))}
        </div>

        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <p className="text-sm font-medium">
            {checks.length === 0 || checks.some((c) => c.state === "pending")
              ? "Running checks…"
              : failing === 0
                ? "Everything is wired up."
                : `${failing} check${failing === 1 ? "" : "s"} failing — fix the red one${failing === 1 ? "" : "s"} above.`}
          </p>
          <p className="mt-1 text-xs text-zinc-400">This page only reads. It never bans anyone.</p>
        </div>

        <Button
          variant="secondary"
          className="mt-4 w-full"
          onClick={() => window.location.reload()}
        >
          Run again
        </Button>
      </main>
    </div>
  );
}
