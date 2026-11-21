/**
 * The Pexels ingestion engine.
 *
 * Called from two places, exactly like the TikTok job:
 *   - the cron route (src/routes/api/pexels/sync.ts), every 15 minutes
 *   - the admin "Sync now" path
 *
 * Flow per source:
 *   list upstream page -> skip ids we already have -> download the MP4 ->
 *   upload it to the `videos` bucket at a deterministic path -> insert the
 *   post row -> mark the source synced.
 *
 * Two properties matter more than speed:
 *   1. **No duplicate posts.** Dedupe happens on `(source_provider, source_id)`
 *      *before* the download, so a re-run costs one query instead of a file
 *      transfer. The unique index is the real guard; the pre-check is just
 *      cheaper.
 *   2. **No orphaned files.** The storage path is derived from the Pexels id
 *      and uploaded with `upsert: true`, so a retry overwrites the same object
 *      instead of creating a second one. If the row insert fails for a reason
 *      other than a duplicate, the object is removed.
 *
 * Failures are recorded per source. One dead query never stops the others.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  PexelsError,
  creditLine,
  fetchPopular,
  pickBestMp4,
  searchVideos,
  type PexelsPage,
  type PexelsVideo,
} from "./pexels.server";

const db = supabaseAdmin as unknown as SupabaseClient;

const PROVIDER = "pexels";
const RIGHTS_BASIS = "pexels_license";
const BUCKET = "videos";
const DOWNLOAD_TIMEOUT_MS = 90_000;
const MAX_DOWNLOAD_BYTES = 120 * 1024 * 1024;

export type PexelsSyncSettings = {
  enabled: boolean;
  interval_minutes: number;
  max_per_source: number;
  max_per_run: number;
  owner_user_id: string | null;
  auto_publish: boolean;
};

export type PexelsSyncSummary = {
  runId: string | null;
  status: "ok" | "partial" | "error" | "skipped";
  sourcesChecked: number;
  videosAdded: number;
  videosSkipped: number;
  apiCalls: number;
  message: string;
};

const DEFAULT_SETTINGS: PexelsSyncSettings = {
  enabled: true,
  interval_minutes: 15,
  max_per_source: 4,
  max_per_run: 8,
  owner_user_id: null,
  auto_publish: true,
};

export async function loadPexelsSettings(): Promise<PexelsSyncSettings> {
  const { data } = await db
    .from("pexels_sync_settings")
    .select("enabled, interval_minutes, max_per_source, max_per_run, owner_user_id, auto_publish")
    .eq("id", 1)
    .maybeSingle();
  if (!data) return { ...DEFAULT_SETTINGS };
  const row = data as Partial<PexelsSyncSettings>;
  return {
    enabled: row.enabled ?? DEFAULT_SETTINGS.enabled,
    interval_minutes: row.interval_minutes ?? DEFAULT_SETTINGS.interval_minutes,
    max_per_source: row.max_per_source ?? DEFAULT_SETTINGS.max_per_source,
    max_per_run: row.max_per_run ?? DEFAULT_SETTINGS.max_per_run,
    owner_user_id: row.owner_user_id ?? null,
    auto_publish: row.auto_publish ?? DEFAULT_SETTINGS.auto_publish,
  };
}

type Owner = { userId: string | null; handle: string | null };

/**
 * The Coolerup account that owns ingested rows.
 *
 * Same precedence as the TikTok job: the pinned `owner_user_id`, then the
 * oldest admin. The real filmmaker is never erased — it goes in
 * `source_author` and the caption, and the card still shows who made it.
 */
async function resolveOwner(settings: PexelsSyncSettings): Promise<Owner> {
  let userId = settings.owner_user_id;
  if (!userId) {
    const { data } = await db
      .from("user_roles")
      .select("user_id, role, created_at")
      .in("role", ["admin", "owner"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    userId = (data as { user_id?: string } | null)?.user_id ?? null;
  }
  if (!userId) return { userId: null, handle: null };

  const { data: profile } = await db
    .from("profiles")
    .select("handle")
    .eq("id", userId)
    .maybeSingle();
  const handle = (profile as { handle?: string | null } | null)?.handle?.trim() || null;
  return { userId, handle };
}

async function finishRun(
  runId: string,
  summary: Omit<PexelsSyncSummary, "runId">,
): Promise<void> {
  await db
    .from("pexels_sync_runs")
    .update({
      status: summary.status,
      finished_at: new Date().toISOString(),
      sources_checked: summary.sourcesChecked,
      videos_added: summary.videosAdded,
      videos_skipped: summary.videosSkipped,
      api_calls: summary.apiCalls,
      message: summary.message.slice(0, 2000),
    })
    .eq("id", runId);
}

export type RunPexelsSyncOptions = {
  trigger: "cron" | "manual";
  force?: boolean;
};

/** Deterministic object key: the same asset always lands on the same path. */
export function storagePathFor(videoId: number | string): string {
  return `pexels/${videoId}.mp4`;
}

/** Feed caption: the credit line, trimmed to the column's practical limit. */
export function captionFor(video: PexelsVideo): string {
  const credit = creditLine(video);
  const tag = video.duration ? ` · ${Math.round(video.duration)}s` : "";
  return `${credit}${tag}`.slice(0, 300);
}

async function downloadMp4(url: string): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`download failed with ${response.status}`);
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_DOWNLOAD_BYTES) {
      throw new Error(`file is too large (${Math.round(declared / 1_048_576)} MB)`);
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) throw new Error("downloaded an empty file");
    if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new Error("file exceeded the size ceiling");
    }
    return new Uint8Array(buffer);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve one source into a page of videos.
 *
 * Pages rotate a little so repeated runs on the same query surface fresh
 * material instead of re-reading page 1 forever.
 */
async function listSource(
  source: { kind: string; value: string },
  perPage: number,
  onApiCall: () => void,
): Promise<PexelsPage> {
  const page = 1 + Math.floor(Math.random() * 4); // 1..4
  const options = { onRetry: () => onApiCall() };
  onApiCall();
  if (source.kind === "search") {
    return searchVideos(source.value, page, perPage, options);
  }
  return fetchPopular(page, perPage, options);
}

export async function runPexelsSync(
  options: RunPexelsSyncOptions,
): Promise<PexelsSyncSummary> {
  const settings = await loadPexelsSettings();

  if (!settings.enabled && options.trigger === "cron") {
    return {
      runId: null,
      status: "skipped",
      sourcesChecked: 0,
      videosAdded: 0,
      videosSkipped: 0,
      apiCalls: 0,
      message: "Pexels sync is turned off in settings.",
    };
  }

  // Claim the slot. The database function owns the advisory lock and the
  // interval guard, so firing this endpoint every minute is harmless.
  let runId: string | null = null;
  if (options.trigger === "cron") {
    const { data, error } = await db.rpc("pexels_claim_run", {
      p_trigger: "cron",
      p_interval_minutes: settings.interval_minutes,
    });
    if (error) {
      return {
        runId: null,
        status: "error",
        sourcesChecked: 0,
        videosAdded: 0,
        videosSkipped: 0,
        apiCalls: 0,
        message: `Could not claim a run slot: ${error.message}`,
      };
    }
    runId = (data as string | null) ?? null;
    if (!runId) {
      return {
        runId: null,
        status: "skipped",
        sourcesChecked: 0,
        videosAdded: 0,
        videosSkipped: 0,
        apiCalls: 0,
        message: "Another run is in flight, or the last one was too recent.",
      };
    }
  } else {
    const { data: running } = await db
      .from("pexels_sync_runs")
      .select("id")
      .eq("status", "running")
      .gt("started_at", new Date(Date.now() - 10 * 60_000).toISOString())
      .limit(1)
      .maybeSingle();
    if (running && !options.force) {
      return {
        runId: null,
        status: "skipped",
        sourcesChecked: 0,
        videosAdded: 0,
        videosSkipped: 0,
        apiCalls: 0,
        message: "A sync is already running.",
      };
    }
    const { data: created, error } = await db
      .from("pexels_sync_runs")
      .insert({ trigger: "manual" })
      .select("id")
      .single();
    if (error || !created) {
      return {
        runId: null,
        status: "error",
        sourcesChecked: 0,
        videosAdded: 0,
        videosSkipped: 0,
        apiCalls: 0,
        message: `Could not start a run: ${error?.message ?? "unknown error"}`,
      };
    }
    runId = (created as { id: string }).id;
  }

  let apiCalls = 0;
  const countApiCall = () => {
    apiCalls += 1;
  };

  try {
    const owner = await resolveOwner(settings);

    const { data: sourceRows, error: sourceError } = await db
      .from("pexels_sources")
      .select("id, kind, value, label")
      .eq("enabled", true)
      .order("last_synced_at", { ascending: true, nullsFirst: true })
      .limit(20);

    if (sourceError) {
      const summary = {
        status: "error" as const,
        sourcesChecked: 0,
        videosAdded: 0,
        videosSkipped: 0,
        apiCalls,
        message: `Could not read sources: ${sourceError.message}`,
      };
      await finishRun(runId, summary);
      return { runId, ...summary };
    }

    const sources = (sourceRows ?? []) as {
      id: string;
      kind: string;
      value: string;
      label: string;
    }[];

    let added = 0;
    let skipped = 0;
    let checked = 0;
    const problems: string[] = [];

    for (const source of sources) {
      if (added >= settings.max_per_run) break;
      checked += 1;
      const name = source.label || `${source.kind}:${source.value}`;

      let page: PexelsPage;
      try {
        page = await listSource(source, Math.max(settings.max_per_source * 3, 12), countApiCall);
      } catch (err) {
        const reason = err instanceof PexelsError ? err.reason : "network_error";
        const message = err instanceof Error ? err.message : "upstream failure";
        await db
          .from("pexels_sources")
          .update({ last_synced_at: new Date().toISOString(), last_error: `${reason}: ${message}`.slice(0, 500) })
          .eq("id", source.id);
        problems.push(`${name}: ${reason}`);
        // A missing key or a rejected key affects every source; stop early.
        if (reason === "no_api_key" || reason === "unauthorized") break;
        continue;
      }

      let sourceAdded = 0;
      for (const video of page.videos ?? []) {
        if (added >= settings.max_per_run) break;
        if (sourceAdded >= settings.max_per_source) break;

        const sourceId = String(video.id);

        // 1. Dedupe before touching the network. Cheapest possible guard.
        const { data: existing } = await db
          .from("videos")
          .select("id")
          .eq("source_provider", PROVIDER)
          .eq("source_id", sourceId)
          .maybeSingle();
        if (existing) {
          skipped += 1;
          continue;
        }

        // 2. Choose a rendition we can actually store.
        const file = pickBestMp4(video);
        if (!file) {
          skipped += 1;
          continue;
        }

        // 3. Download.
        let bytes: Uint8Array;
        try {
          bytes = await downloadMp4(file.link);
        } catch (err) {
          problems.push(`${name} #${sourceId}: ${(err as Error).message}`);
          skipped += 1;
          continue;
        }

        // 4. Upload to the deterministic path. `upsert` makes a retry safe:
        //    it replaces the same object rather than orphaning the old one.
        const path = storagePathFor(video.id);
        const { error: uploadError } = await supabaseAdmin.storage
          .from(BUCKET)
          .upload(path, bytes, { contentType: "video/mp4", upsert: true });
        if (uploadError) {
          problems.push(`${name} #${sourceId}: upload failed (${uploadError.message})`);
          skipped += 1;
          continue;
        }

        // 5. Publish the post.
        const { error: insertError } = await db.from("videos").insert({
          user_id: owner.userId,
          username: owner.handle ?? "coolerup",
          caption: captionFor(video),
          video_url: `storage:${path}`,
          hidden: !settings.auto_publish,
          quality: "auto",
          source_provider: PROVIDER,
          source_id: sourceId,
          source_url: video.url,
          source_author: video.user?.name ?? null,
          rights_basis: RIGHTS_BASIS,
        });

        if (insertError) {
          if (/duplicate key|unique/i.test(insertError.message)) {
            // Another run won the race; the file is shared, so leave it.
            skipped += 1;
          } else {
            // The row will never exist, so the file must not linger.
            await supabaseAdmin.storage.from(BUCKET).remove([path]);
            problems.push(`${name} #${sourceId}: ${insertError.message}`);
            skipped += 1;
          }
          continue;
        }

        added += 1;
        sourceAdded += 1;
      }

      await db
        .from("pexels_sources")
        .update({ last_synced_at: new Date().toISOString(), last_error: null })
        .eq("id", source.id);
    }

    const status: PexelsSyncSummary["status"] = problems.length === 0 ? "ok" : "partial";
    const message =
      sources.length === 0
        ? "No enabled Pexels sources — add one in the admin panel."
        : `Checked ${checked} source(s), added ${added}, skipped ${skipped}, ${apiCalls} API call(s).` +
          (problems.length ? ` Notes: ${problems.slice(0, 6).join("; ")}` : "");

    const summary = {
      status,
      sourcesChecked: checked,
      videosAdded: added,
      videosSkipped: skipped,
      apiCalls,
      message,
    };
    await finishRun(runId, summary);
    return { runId, ...summary };
  } catch (err) {
    const summary = {
      status: "error" as const,
      sourcesChecked: 0,
      videosAdded: 0,
      videosSkipped: 0,
      apiCalls,
      message: err instanceof Error ? err.message : "Unexpected sync failure.",
    };
    await finishRun(runId, summary);
    return { runId, ...summary };
  }
}
