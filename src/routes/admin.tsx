import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Ban,
  Check,
  Clock,
  Coins,
  Crown,
  Flag,
  Gift,
  Loader2,
  Power,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FreeCoinClaimsPanel } from "@/components/FreeCoinClaimsPanel";
import { TikTokSyncPanel } from "@/components/TikTokSyncPanel";
import { AgeVerificationAdminPanel } from "@/components/AgeVerificationAdminPanel";
import {
  adminCoinVenmoOrders,
  adminReviewCoinVenmoOrder,
  type AdminVenmoOrder,
} from "@/lib/coins.functions";
import { usdFromCents } from "@/lib/coins";
import { venmoStatusLabel } from "@/lib/venmo";
import { PayoutsPanel } from "@/components/PayoutsPanel";
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
import {
  adminBanList,
  adminBotLogs,
  scanPublishedVideos,
  safetyBotSweep,
  purgeHiddenVideos,
  amIOwner,
  ownerUnban,
  VIOLATION_LABEL,
  type BanListRow,
  type BotLogRow,
  type ViolationKind,
} from "@/lib/autoBans";
import { SafetyBotBadge, SAFETY_BOT_HANDLE } from "@/components/SafetyBotBadge";
import { appBuildId } from "@/lib/appBuild";
import {
  DEFAULT_MAINTENANCE_MESSAGE,
  fetchAppStatus,
  setAppStatus,
  type AppStatus,
} from "@/lib/maintenance";

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

type Tab =
  | "reports"
  | "bans"
  | "banlist"
  | "botlogs"
  | "log"
  | "coins"
  | "free"
  | "payouts"
  | "tiktok"
  | "ageverify"
  | "update";

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
  const [banList, setBanList] = useState<BanListRow[]>([]);
  const [botLogs, setBotLogs] = useState<BotLogRow[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [coinOrders, setCoinOrders] = useState<AdminVenmoOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);

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
      try {
        setBanList(await adminBanList());
        setIsOwner(await amIOwner());
      } catch {
        // Ban list is additive; a missing migration must not blank the page.
        setBanList([]);
        setIsOwner(false);
      }
      try {
        setBotLogs(await adminBotLogs(200));
      } catch {
        // Bot logs are additive too.
        setBotLogs([]);
      }
      try {
        setCoinOrders(await adminCoinVenmoOrders());
      } catch {
        // Coin orders are optional; a failure here shouldn't blank moderation.
        setCoinOrders([]);
      }
      const s = await fetchAppStatus();
      setStatus(s);
      if (s?.message) setStatusMsg(s.message);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load moderation data");
    } finally {
      setLoading(false);
    }
  }, []);

  const [sweeping, setSweeping] = useState(false);
  const [sweepSummary, setSweepSummary] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState("0/0");
  const [scanSummary, setScanSummary] = useState("");

  /**
   * Clean what is already published.
   *
   * The database triggers cover new writes only, so this asks Postgres to walk
   * every existing video, comment and profile with the same rules. It is the
   * button that makes "take it down right now" true for content that predates
   * the triggers.
   */
  const runSweep = useCallback(async () => {
    setSweeping(true);
    setSweepSummary("");
    try {
      const res = await safetyBotSweep();
      if (!res.ok) {
        setSweepSummary(res.error || "Sweep failed");
        return;
      }
      setSweepSummary(
        `Hid ${res.videos_hidden} video${res.videos_hidden === 1 ? "" : "s"} · ` +
          `removed ${res.comments_removed} comment${res.comments_removed === 1 ? "" : "s"} · ` +
          `cleared ${res.profiles_cleared} profile${res.profiles_cleared === 1 ? "" : "s"}`,
      );
      await refresh();
    } catch (e) {
      setSweepSummary(e instanceof Error ? e.message : "Sweep failed");
    } finally {
      setSweeping(false);
    }
  }, [refresh]);

  /** Delete the hidden videos for good, so they stop costing storage. */
  const runPurge = useCallback(async () => {
    setSweeping(true);
    setSweepSummary("");
    try {
      const res = await purgeHiddenVideos();
      if (!res.ok) {
        setSweepSummary(res.error || "Purge failed");
        return;
      }
      setSweepSummary(`Deleted ${res.deleted} hidden video${res.deleted === 1 ? "" : "s"}`);
      await refresh();
    } catch (e) {
      setSweepSummary(e instanceof Error ? e.message : "Purge failed");
    } finally {
      setSweeping(false);
    }
  }, [refresh]);

  const runScan = useCallback(async () => {
    setScanning(true);
    setScanSummary("");
    try {
      const report = await scanPublishedVideos({
        limit: 30,
        onProgress: (done, total) => setScanProgress(`${done}/${total}`),
      });
      setScanSummary(
        `Scanned ${report.scanned} video${report.scanned === 1 ? "" : "s"} · ` +
          `${report.hits.length} explicit · ${report.hits.filter((h) => h.banned).length} banned · ` +
          `${report.skipped} skipped · ${report.failed} failed`,
      );
      if (report.hits.length > 0) await refresh();
    } catch (e) {
      setScanSummary(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }, [refresh]);

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

  /**
   * Flip the update switch. This is the "shut the app down" button: everyone
   * else's tab stops rendering the app within ~15s and shows a holding page
   * until it's switched back off.
   */
  const toggleMaintenance = async (on: boolean) => {
    setStatusBusy(true);
    try {
      const res = await setAppStatus(on, statusMsg || null);
      if (!res.ok) {
        toast.error(res.error || "Couldn't change update mode");
        return;
      }
      toast.success(on ? "App is shut down for everyone" : "App is back up");
      setStatus(await fetchAppStatus());
    } finally {
      setStatusBusy(false);
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
  const pendingCoins = coinOrders.filter((o) => o.status === "submitted").length;

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
        <Button asChild variant="secondary" size="sm" className="gap-2">
          <Link to="/admin/codes">
            <Gift className="h-4 w-4" />
            Codes
          </Link>
        </Button>
        <Button asChild variant="secondary" size="sm" className="gap-2">
          <Link to="/admin/subscriptions">
            <Crown className="h-4 w-4" />
            Lifetime
          </Link>
        </Button>
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

      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-muted p-1">
        {(
          [
            ["reports", `Reports (${pending.length})`],
            ["bans", `Bans (${activeBans.length + activeMutes.length})`],
            ["banlist", "Ban List"],
            ["botlogs", "AI Bot Logs"],
            ["log", "Auto-ban log"],
            ["coins", `Coins (${pendingCoins})`],
            ["free", "Free coins"],
            ["payouts", "Payouts"],
            ["tiktok", "TikTok"],
            ["ageverify", "ID Checks"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex-1 whitespace-nowrap rounded-md px-2 py-2 text-xs font-semibold transition ${
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

      {tab === "banlist" && (
        <section className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Every auto-ban and strike, with the warning level it reached.{" "}
            {isOwner ? "As the owner you can unban here." : "Only @drewmclawhorn3 can unban."}
          </p>
          <div className="rounded-xl border bg-card p-3">
            <p className="text-sm font-medium">Scan the feed for explicit videos</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Checks the last 30 published videos on this device and removes + bans anything
              explicit. Uploads are already checked automatically; this cleans up anything posted
              before the classifier existed.
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              disabled={scanning}
              onClick={runScan}
            >
              {scanning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Scanning {scanProgress}
                </>
              ) : (
                "Scan last 30 videos"
              )}
            </Button>
            {scanSummary && <p className="mt-2 text-xs text-muted-foreground">{scanSummary}</p>}
          </div>
          {banList.length === 0 && <Empty text="No auto bans yet." />}
          {banList.map((row) => {
            const strike = Math.min(Math.max(row.strike_count, 1), 3);
            const kindLabel =
              VIOLATION_LABEL[row.last_kind as ViolationKind] ?? row.last_kind ?? "Rule break";
            return (
              <article
                key={row.id}
                className={`rounded-xl border p-3 ${
                  row.active
                    ? "border-destructive/40 bg-destructive/5"
                    : "border-border bg-card opacity-70"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <Link
                    to="/u/$username"
                    params={{ username: row.username }}
                    className="hover:text-primary"
                  >
                    @{row.username}
                  </Link>
                  <span className="rounded-full bg-[#FE2C55]/15 px-2 py-0.5 text-[11px] font-bold text-[#FE2C55]">
                    Warning {strike}/3
                  </span>
                  {row.is_permanent && (
                    <span className="rounded-full bg-destructive px-2 py-0.5 text-[11px] font-bold text-white">
                      permanent
                    </span>
                  )}
                  {row.auto && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      auto
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {kindLabel}
                  {row.last_content_type && row.last_content_type !== "none"
                    ? ` \u00b7 ${row.last_content_type}`
                    : ""}
                  {row.reason ? ` \u2014 ${row.reason}` : ""}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {when(row.created_at)}
                  {row.identity_count > 0
                    ? ` \u00b7 ${row.identity_count} device/email/phone ban${row.identity_count === 1 ? "" : "s"}`
                    : ""}
                  {row.banned_by ? ` \u00b7 by ${row.banned_by}` : ""}
                </p>
                {isOwner && row.active && (
                  <div className="mt-3">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy === `ob-${row.id}`}
                      onClick={() =>
                        void run(
                          `ob-${row.id}`,
                          async () => {
                            const res = await ownerUnban(row.username);
                            return res.ok ? { ok: true } : res;
                          },
                          `@${row.username} unbanned`,
                        )
                      }
                    >
                      <Undo2 className="h-3.5 w-3.5" /> Unban
                    </Button>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}

      {tab === "botlogs" && (
        <section className="space-y-3">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
            <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
              <SafetyBotBadge /> AI Bot Logs
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Everything the Safety Bot removed, muted or banned, with the content it acted on and
              why. Unban is owner-only (@drewmclawhorn3).
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={runSweep} disabled={sweeping}>
                {sweeping ? "Cleaning…" : "Clean the app now"}
              </Button>
              <Button size="sm" variant="outline" onClick={runPurge} disabled={sweeping}>
                Delete hidden videos
              </Button>
            </div>
            {sweepSummary && (
              <p className="mt-2 text-xs font-medium text-emerald-400">{sweepSummary}</p>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
              New posts, comments, messages and bios are screened the instant they are saved. The
              buttons above clean anything that was posted before that was switched on.
            </p>
          </div>
          {botLogs.length === 0 && <Empty text="The Safety Bot has not taken any action yet." />}
          {botLogs.map((l) => {
            const kindLabel =
              VIOLATION_LABEL[l.kind as ViolationKind] ?? l.kind ?? "Rule break";
            const active =
              l.is_permanent ||
              (l.expires_at ? new Date(l.expires_at).getTime() > Date.now() : false);
            return (
              <article key={l.id} className="rounded-xl border border-border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <Link
                    to="/u/$username"
                    params={{ username: SAFETY_BOT_HANDLE }}
                    className="text-emerald-400 hover:underline"
                  >
                    Safety Bot
                  </Link>
                  <span className="text-muted-foreground">→</span>
                  {l.username ? (
                    <Link
                      to="/u/$username"
                      params={{ username: l.username }}
                      className="hover:text-primary"
                    >
                      @{l.username}
                    </Link>
                  ) : (
                    <span>unknown</span>
                  )}
                  <span className="rounded-full bg-[#FE2C55]/15 px-2 py-0.5 text-[11px] font-bold text-[#FE2C55]">
                    {l.action}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {kindLabel}
                  </span>
                  {l.strike_count > 0 && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      strike {Math.min(l.strike_count, 3)}/3
                    </span>
                  )}
                  {l.is_permanent && (
                    <span className="rounded-full bg-destructive px-2 py-0.5 text-[11px] font-bold text-white">
                      permanent
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {l.reason || "—"}
                  {l.content_type && l.content_type !== "none" ? ` · ${l.content_type}` : ""}
                </p>
                {l.content_excerpt && (
                  <p className="mt-2 rounded-lg bg-black px-3 py-2 text-xs text-white/70">
                    “{l.content_excerpt}”
                  </p>
                )}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {when(l.created_at)} · by {l.actor || "Safety Bot"}
                  {l.expires_at ? ` · until ${when(l.expires_at)}` : ""}
                </p>
                {isOwner && active && l.username && (
                  <div className="mt-3">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy === `bl-${l.id}`}
                      onClick={() =>
                        void run(
                          `bl-${l.id}`,
                          async () => {
                            const res = await ownerUnban(l.username as string);
                            return res.ok ? { ok: true } : res;
                          },
                          `@${l.username} unbanned`,
                        )
                      }
                    >
                      <Undo2 className="h-3.5 w-3.5" /> Unban
                    </Button>
                  </div>
                )}
              </article>
            );
          })}
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

      {tab === "coins" && (
        <section className="space-y-3">
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            Open Venmo, find the payment whose note matches the order code, then approve it.
            Approving credits the coins once — double-clicking is safe.
          </p>
          {coinOrders.length === 0 && <Empty text="No Venmo orders yet." />}
          {coinOrders.map((order) => (
            <CoinOrderCard key={order.id} order={order} onReviewed={() => void refresh()} />
          ))}
        </section>
      )}

      {tab === "free" && (
        <section className="space-y-3">
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            Everyone claiming the daily 10 free coins through Venmo, newest first. Updates live.
          </p>
          <FreeCoinClaimsPanel />
        </section>
      )}

      {tab === "payouts" && (
        <section className="space-y-3">
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            Creators cash out diamonds, creator-fund earnings and gift income at $10 or more. Pay
            them in Venmo or Stripe, then mark it paid so it leaves the queue.{" "}
            <Link to="/admin/payouts" className="font-semibold text-primary hover:underline">
              Open the full page
            </Link>
          </p>
          <PayoutsPanel />
        </section>
      )}

      {tab === "tiktok" && (
        <section className="space-y-3">
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            Coolerup pulls TikTok videos into the library on a schedule. We store the share link and
            cover and play the clip through TikTok&rsquo;s own embed — no files are rehosted.
            Changes here apply to the next run.
          </p>
          <TikTokSyncPanel />
        </section>
      )}

      {tab === "ageverify" && <AgeVerificationAdminPanel />}

      {tab === "update" && (
        <section className="space-y-4">
          <article
            className={`rounded-xl border p-4 ${
              status?.maintenance
                ? "border-destructive/40 bg-destructive/5"
                : "border-border bg-card"
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  status?.maintenance ? "bg-destructive/15" : "bg-primary/15"
                }`}
              >
                <Power
                  className={`h-5 w-5 ${status?.maintenance ? "text-destructive" : "text-primary"}`}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {status?.maintenance ? "App is shut down" : "App is live"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {status?.maintenance
                    ? "Everyone sees a holding page instead of the app — you included. To get back in, turn this switch off from the Supabase table editor (app_settings, id = 1)."
                    : "Turn this on before you publish an update. Every open tab shuts down within ~15 seconds, and comes back on its own when you turn it off."}
                </p>
                {status?.updatedAt && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    changed {when(status.updatedAt)}
                  </p>
                )}
              </div>
            </div>

            <label
              className="mt-4 block text-xs font-medium text-muted-foreground"
              htmlFor="maintenance-message"
            >
              Message shown to users
            </label>
            <textarea
              id="maintenance-message"
              value={statusMsg}
              onChange={(e) => setStatusMsg(e.target.value)}
              rows={2}
              placeholder={DEFAULT_MAINTENANCE_MESSAGE}
              className="mt-1 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />

            <Button
              className="mt-3 w-full"
              variant={status?.maintenance ? "default" : "destructive"}
              disabled={statusBusy || status === null}
              onClick={() => void toggleMaintenance(!status?.maintenance)}
            >
              {statusBusy
                ? "Working…"
                : status?.maintenance
                  ? "Bring the app back up"
                  : "Shut the app down"}
            </Button>
          </article>

          <article className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm font-semibold">Automatic shutdown on new builds</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Every build carries an id. When a newer one is published, open tabs shut down and
              reload themselves into it — no switch to flip. This build:{" "}
              <code className="rounded bg-muted px-1">{appBuildId()}</code>
            </p>
          </article>
        </section>
      )}
    </main>
  );
}

function CoinOrderCard({ order, onReviewed }: { order: AdminVenmoOrder; onReviewed: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  const reviewable = order.status === "submitted" || order.status === "awaiting_payment";

  async function review(action: "approve" | "reject") {
    setBusy(action);
    try {
      const payload: { orderId: string; action: "approve" | "reject"; note?: string } = {
        orderId: order.id,
        action,
      };
      const trimmed = note.trim();
      if (trimmed) payload.note = trimmed;

      const result = await adminReviewCoinVenmoOrder({ data: payload });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(
        action === "approve"
          ? result.alreadyPaid
            ? "Already credited"
            : `+${result.coins.toLocaleString()} coins credited`
          : "Order rejected",
      );
      setNote("");
      onReviewed();
    } catch {
      toast.error("Couldn't review that order");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
        <Coins className="h-4 w-4 text-yellow-500" />
        <code className="font-mono">{order.reference_code}</code>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {venmoStatusLabel(order.status)}
        </span>
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {usdFromCents(order.amount_cents)} · {order.coins.toLocaleString()} coins
        </span>
      </div>

      <p className="mt-1 text-sm">
        <Link
          to="/u/$username"
          params={{ username: order.username ?? "" }}
          className="font-semibold hover:text-primary"
        >
          @{order.username ?? "unknown"}
        </Link>
        {order.payer_handle && (
          <span className="text-muted-foreground">
            {" "}
            paid from <span className="font-semibold text-foreground">@{order.payer_handle}</span>
          </span>
        )}
      </p>

      {order.venmo_note && (
        <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">“{order.venmo_note}”</p>
      )}
      {order.admin_note && (
        <p className="mt-1 text-xs text-muted-foreground">Note: {order.admin_note}</p>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        {when(order.created_at)}
        {order.reviewed_at ? ` · reviewed ${when(order.reviewed_at)}` : ""}
      </p>

      {reviewable && (
        <>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note (shown to the buyer)"
            className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy !== null}
              className="gap-1.5"
              onClick={() => void review("approve")}
            >
              <Check className="h-3.5 w-3.5" /> Approve &amp; credit
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy !== null}
              className="gap-1.5"
              onClick={() => void review("reject")}
            >
              <X className="h-3.5 w-3.5" /> Reject
            </Button>
          </div>
        </>
      )}
    </article>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
