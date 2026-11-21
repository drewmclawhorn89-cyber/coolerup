import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  addTikTokSource,
  deleteTikTokSource,
  getTikTokStatus,
  runTikTokSyncNow,
  setTikTokSourceEnabled,
  updateTikTokSettings,
  type TikTokRunRow,
  type TikTokSourceRow,
  type TikTokStatus,
} from "@/lib/tiktok.functions";

/**
 * Admin panel for the 24/7 TikTok pull.
 *
 * Shows what is being watched, when it last ran, and what went wrong. The
 * "Sync now" button runs the exact same engine as the cron route, so what you
 * see here is what the scheduler does.
 */
export function TikTokSyncPanel() {
  const [status, setStatus] = useState<TikTokStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  const load = useServerFn(getTikTokStatus);
  const add = useServerFn(addTikTokSource);
  const toggle = useServerFn(setTikTokSourceEnabled);
  const remove = useServerFn(deleteTikTokSource);
  const saveSettings = useServerFn(updateTikTokSettings);
  const syncNow = useServerFn(runTikTokSyncNow);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await load());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load TikTok sync status.");
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    setBusy("add");
    try {
      await add({ data: { input: draft.trim() } });
      setDraft("");
      toast.success("Source added. It will sync on the next run.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add that source.");
    } finally {
      setBusy(null);
    }
  }

  async function onToggle(source: TikTokSourceRow) {
    setBusy(source.id);
    try {
      await toggle({ data: { id: source.id, enabled: !source.enabled } });
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the source.");
    } finally {
      setBusy(null);
    }
  }

  async function onDelete(source: TikTokSourceRow) {
    setBusy(source.id);
    try {
      await remove({ data: { id: source.id } });
      toast.success("Source removed.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove the source.");
    } finally {
      setBusy(null);
    }
  }

  async function onSetting(patch: Record<string, boolean | number>) {
    setBusy("settings");
    try {
      await saveSettings({ data: patch });
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setBusy(null);
    }
  }

  async function onSyncNow() {
    setBusy("sync");
    try {
      const summary = await syncNow();
      if (summary.status === "error") toast.error(summary.message);
      else if (summary.status === "skipped") toast.info(summary.message);
      else toast.success(summary.message);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The sync failed.");
    } finally {
      setBusy(null);
    }
  }

  if (loading && !status) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading TikTok sync…
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <p className="font-semibold text-destructive">TikTok sync is not set up yet.</p>
        <p className="mt-1 text-muted-foreground">{error}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Run the migration <code>20261214000000_tiktok_sync.sql</code> in Supabase, then refresh.
        </p>
      </div>
    );
  }

  if (!status) return null;

  return (
    <div className="space-y-4">
      <article className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold">
              {status.settings.enabled ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <Pause className="h-4 w-4 text-muted-foreground" />
              )}
              {status.settings.enabled ? "Pulling TikTok 24/7" : "Paused"}
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {status.discovery.mode === "display_api" ? "Display API" : "Public pages"}
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Every {status.settings.interval_minutes} min · up to {status.settings.max_per_source}{" "}
              per source · {status.counts.published} published
              {status.counts.drafts > 0 ? ` · ${status.counts.drafts} awaiting review` : ""} ·{" "}
              {status.counts.total} TikTok videos in the feed
            </p>
            {status.discovery.mode === "public_pages" && (
              <p className="mt-2 max-w-xl rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                Without <code>TIKTOK_ACCESS_TOKEN</code>, creator sources can only read the public
                profile page, which TikTok often blocks. Single video links always work. Add a token
                to discover new posts reliably.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => void refresh()}
              disabled={loading}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button onClick={() => void onSyncNow()} disabled={busy !== null} className="gap-2">
              {busy === "sync" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Sync now
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm">
            <span>Keep pulling</span>
            <Switch
              checked={status.settings.enabled}
              onCheckedChange={(checked) => void onSetting({ enabled: checked })}
              disabled={busy !== null}
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm">
            <span>Publish automatically</span>
            <Switch
              checked={status.settings.auto_publish}
              onCheckedChange={(checked) => void onSetting({ auto_publish: checked })}
              disabled={busy !== null}
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm">
            <span>Minutes between runs</span>
            <Input
              type="number"
              min={5}
              max={1440}
              defaultValue={status.settings.interval_minutes}
              onBlur={(event) => {
                const value = Number(event.target.value);
                if (value !== status.settings.interval_minutes)
                  void onSetting({ interval_minutes: value });
              }}
              className="h-8 w-20"
            />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm">
            <span>Videos per source</span>
            <Input
              type="number"
              min={1}
              max={50}
              defaultValue={status.settings.max_per_source}
              onBlur={(event) => {
                const value = Number(event.target.value);
                if (value !== status.settings.max_per_source)
                  void onSetting({ max_per_source: value });
              }}
              className="h-8 w-20"
            />
          </label>
        </div>
      </article>

      {/* What actually landed. Without this an admin has to scroll the swipe
          feed to find out whether a sync did anything. */}
      <article className="rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-semibold">Videos pulled from TikTok</p>
        <p className="mt-1 text-xs text-muted-foreground">
          These live in the swipe feed at <code>/</code>. Newest first.
        </p>
        {status.videos.length === 0 ? (
          <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            Nothing pulled yet. Add a source and press Sync now.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {status.videos.map((video) => (
              <li key={video.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    <span className="font-semibold">
                      @{video.tiktok_author || video.username || "unknown"}
                    </span>
                    {video.caption ? (
                      <span className="text-muted-foreground"> · {video.caption}</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {video.tiktok_id ? `video ${video.tiktok_id}` : "creator embed card"} ·{" "}
                    {new Date(video.created_at).toLocaleString()}
                    {video.hidden ? " · hidden" : ""}
                  </p>
                </div>
                {video.video_url ? (
                  <a
                    href={video.video_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="shrink-0 text-xs underline"
                  >
                    Open on TikTok
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </article>

      <form onSubmit={onAdd} className="flex flex-wrap gap-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="@creator, https://www.tiktok.com/@creator/video/123…, or #hashtag"
          aria-label="TikTok creator, video link, or hashtag"
          className="min-w-0 flex-1"
          disabled={busy !== null}
        />
        <Button type="submit" disabled={!draft.trim() || busy !== null} className="gap-2">
          {busy === "add" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Add source
        </Button>
      </form>

      <div className="space-y-2">
        {status.sources.length === 0 && (
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            No sources yet. Add a creator handle to pull their newest videos, or paste a single
            video link to add it once.
          </p>
        )}
        {status.sources.map((source) => (
          <article
            key={source.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                <span className="mr-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {source.kind}
                </span>
                {source.label || source.value}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {source.last_synced_at
                  ? `Last checked ${new Date(source.last_synced_at).toLocaleString()}`
                  : "Not checked yet"}
                {source.last_error ? ` · ${source.last_error}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={source.enabled}
                onCheckedChange={() => void onToggle(source)}
                disabled={busy === source.id}
                aria-label={source.enabled ? "Pause source" : "Resume source"}
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void onDelete(source)}
                disabled={busy === source.id}
                aria-label="Remove source"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </article>
        ))}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Recent runs
        </p>
        {status.runs.length === 0 && (
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            No runs yet. The first cron tick will appear here.
          </p>
        )}
        {status.runs.map((run) => (
          <RunRow key={run.id} run={run} />
        ))}
      </div>
    </div>
  );
}

function RunRow({ run }: { run: TikTokRunRow }) {
  const icon =
    run.status === "ok" ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
    ) : run.status === "running" ? (
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    ) : run.status === "error" ? (
      <XCircle className="h-4 w-4 text-destructive" />
    ) : (
      <Clock className="h-4 w-4 text-amber-500" />
    );

  return (
    <article className="rounded-lg border border-border bg-card px-3 py-2 text-xs">
      <p className="flex flex-wrap items-center gap-2 font-semibold">
        {icon}
        <span className="uppercase tracking-wide">{run.status}</span>
        <span className="text-muted-foreground">{run.trigger}</span>
        <span className="text-muted-foreground">{new Date(run.started_at).toLocaleString()}</span>
        <span className="text-muted-foreground">
          +{run.videos_added} new · {run.videos_skipped} known · {run.sources_checked} sources
        </span>
      </p>
      {run.message && <p className="mt-1 text-muted-foreground">{run.message}</p>}
    </article>
  );
}
