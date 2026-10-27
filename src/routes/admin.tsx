import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Ban,
  Clock,
  Flag,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  REPORT_REASONS,
  adminBan,
  adminBans,
  adminDismissReport,
  adminModerationLog,
  adminReports,
  adminUnban,
  amIAdmin,
  type AdminBan,
  type AdminReport,
  type ModerationLogRow,
} from "@/lib/moderation";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Moderation — Coolerup" },
      { name: "description", content: "Review reports, manage bans, and audit auto-moderation." },
      { property: "og:title", content: "Moderation — Coolerup" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminPage,
});

type Tab = "reports" | "bans" | "log";

const reasonLabel = (id: string) => REPORT_REASONS.find((r) => r.id === id)?.label ?? id;

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const banLength = (b: AdminBan) => {
  if (b.is_permanent) return "Permanent";
  if (!b.expires_at) return "Indefinite";
  const ms = new Date(b.expires_at).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const hours = Math.round(ms / 3_600_000);
  return hours >= 48 ? `${Math.round(hours / 24)}d left` : `${hours}h left`;
};

function AdminPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("reports");
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [bans, setBans] = useState<AdminBan[]>([]);
  const [log, setLog] = useState<ModerationLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [r, b, l] = await Promise.all([
        adminReports(200),
        adminBans(),
        adminModerationLog(200),
      ]);
      setReports(r);
      setBans(b);
      setLog(l);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load moderation data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void amIAdmin().then((ok) => {
      if (!active) return;
      setIsAdmin(ok);
      if (ok) void refresh();
    });
    return () => {
      active = false;
    };
  }, [refresh]);

  const run = async (
    key: string,
    fn: () => Promise<{ ok: boolean; error?: string | undefined }>,
    success: string,
  ) => {
    setBusy(key);
    try {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error || "Action failed");
        return;
      }
      toast.success(success);
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  if (isAdmin === null) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
        Checking permissions…
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/15">
          <ShieldOff className="h-8 w-8 text-destructive" />
        </div>
        <h1 className="text-xl font-bold">Admins only</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          This page is for moderators. If you think you should have access, ask an admin to grant
          you the <code className="rounded bg-muted px-1">admin</code> role.
        </p>
        <Button asChild variant="secondary">
          <Link to="/">Back to the feed</Link>
        </Button>
      </main>
    );
  }

  const pending = reports.filter((r) => r.status === "pending");
  const activeBans = bans.filter((b) => b.active && b.kind === "ban");
  const activeMutes = bans.filter((b) => b.active && b.kind === "mute");

  return (
    <main className="mx-auto min-h-dvh w-full max-w-4xl bg-background px-4 pb-24 pt-4">
      <header className="mb-5 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back">
          <Link to="/">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-lg font-bold">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Moderation
          </h1>
          <p className="text-xs text-muted-foreground">
            {pending.length} pending · {activeBans.length} banned · {activeMutes.length} muted
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void refresh()}
          disabled={loading}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </header>

      <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1">
        {(
          [
            ["reports", `Reports (${pending.length})`],
            ["bans", `Bans (${activeBans.length + activeMutes.length})`],
            ["log", "Auto-ban log"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold transition ${
              tab === id ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "reports" && (
        <section className="space-y-3">
          {reports.length === 0 && <Empty text="No reports yet. Nice." />}
          {reports.map((r) => (
            <article key={r.id} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <Flag className="h-4 w-4 text-destructive" />
                    {reasonLabel(r.reason)}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {r.status}
                    </span>
                    {r.action_taken && (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                        {r.action_taken}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-sm">
                    <span className="text-muted-foreground">reported</span>{" "}
                    <Link
                      to="/u/$username"
                      params={{ username: r.reported_username }}
                      className="font-semibold hover:text-primary"
                    >
                      @{r.reported_username}
                    </Link>{" "}
                    <span className="text-muted-foreground">by</span> @{r.reporter_username}
                  </p>
                  {r.details && (
                    <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">“{r.details}”</p>
                  )}
                  <p className="mt-1 text-[11px] text-muted-foreground">{when(r.created_at)}</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy === `24-${r.id}`}
                  onClick={() =>
                    void run(
                      `24-${r.id}`,
                      () =>
                        adminBan(
                          r.reported_username,
                          24,
                          false,
                          `Report: ${reasonLabel(r.reason)}`,
                        ),
                      `@${r.reported_username} banned for 24h`,
                    )
                  }
                >
                  <Clock className="h-3.5 w-3.5" /> Ban 24h
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy === `7-${r.id}`}
                  onClick={() =>
                    void run(
                      `7-${r.id}`,
                      () =>
                        adminBan(
                          r.reported_username,
                          168,
                          false,
                          `Report: ${reasonLabel(r.reason)}`,
                        ),
                      `@${r.reported_username} banned for 7 days`,
                    )
                  }
                >
                  <Clock className="h-3.5 w-3.5" /> Ban 7d
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy === `perm-${r.id}`}
                  onClick={() =>
                    void run(
                      `perm-${r.id}`,
                      () =>
                        adminBan(
                          r.reported_username,
                          null,
                          true,
                          `Report: ${reasonLabel(r.reason)}`,
                        ),
                      `@${r.reported_username} permanently banned`,
                    )
                  }
                >
                  <Ban className="h-3.5 w-3.5" /> Permanent
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === `unban-${r.id}`}
                  onClick={() =>
                    void run(
                      `unban-${r.id}`,
                      () => adminUnban(r.reported_username),
                      `@${r.reported_username} unbanned`,
                    )
                  }
                >
                  <Undo2 className="h-3.5 w-3.5" /> Unban
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === `dismiss-${r.id}`}
                  onClick={() =>
                    void run(`dismiss-${r.id}`, () => adminDismissReport(r.id), "Report dismissed")
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" /> Dismiss
                </Button>
              </div>
            </article>
          ))}
        </section>
      )}

      {tab === "bans" && (
        <section className="space-y-3">
          {bans.length === 0 && <Empty text="Nobody is banned or muted." />}
          {bans.map((b) => (
            <article
              key={b.id}
              className={`rounded-xl border p-3 ${b.active ? "border-destructive/40 bg-destructive/5" : "border-border bg-card opacity-70"}`}
            >
              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                <Link
                  to="/u/$username"
                  params={{ username: b.username }}
                  className="hover:text-primary"
                >
                  @{b.username}
                </Link>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {b.kind}
                </span>
                {b.auto && (
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                    auto
                  </span>
                )}
                <span className="text-xs font-normal text-muted-foreground">{banLength(b)}</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {b.reason || "No reason recorded"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {when(b.created_at)} · by {b.banned_by || "unknown"}
                {b.report_count ? ` · ${b.report_count} reports` : ""}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {!b.active && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === `re-${b.id}`}
                    onClick={() =>
                      void run(
                        `re-${b.id}`,
                        () => adminBan(b.username, 24, false, "Re-banned by admin"),
                        `@${b.username} banned for 24h`,
                      )
                    }
                  >
                    <Clock className="h-3.5 w-3.5" /> Ban 24h
                  </Button>
                )}
                {b.active && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === `un-${b.id}`}
                    onClick={() =>
                      void run(
                        `un-${b.id}`,
                        () => adminUnban(b.username),
                        `@${b.username} unbanned`,
                      )
                    }
                  >
                    <Undo2 className="h-3.5 w-3.5" /> Unban
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy === `p-${b.id}`}
                  onClick={() =>
                    void run(
                      `p-${b.id}`,
                      () => adminBan(b.username, null, true, "Permanent ban by admin"),
                      `@${b.username} permanently banned`,
                    )
                  }
                >
                  <Ban className="h-3.5 w-3.5" /> Permanent
                </Button>
              </div>
            </article>
          ))}
        </section>
      )}

      {tab === "log" && (
        <section className="space-y-2">
          {log.length === 0 && <Empty text="No moderation actions yet." />}
          {log.map((l) => (
            <article key={l.id} className="rounded-lg border border-border bg-card px-3 py-2">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{l.username ? `@${l.username}` : "unknown"}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {l.action}
                </span>
                {l.auto ? (
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                    auto
                  </span>
                ) : (
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium">
                    manual
                  </span>
                )}
                {l.is_permanent && (
                  <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
                    permanent
                  </span>
                )}
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {when(l.created_at)}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {l.reason || "—"}
                {l.report_count ? ` · ${l.report_count} reports` : ""} · by {l.actor || "system"}
              </p>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
