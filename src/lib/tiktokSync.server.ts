/**
 * The TikTok sync engine.
 *
 * One function, called from two places:
 *   - the cron route  (src/routes/api/tiktok/sync.ts), every 15 minutes
 *   - the admin panel ("Sync now")
 *
 * It is deliberately boring: read settings, read enabled sources, resolve each
 * source into a handful of videos, insert the ones we have never seen, write a
 * run row. Every failure is recorded per source instead of thrown, so one dead
 * creator cannot stop the other sources from syncing.
 *
 * Concurrency: the cron path claims its slot through `tiktok_claim_run()`,
 * which takes an advisory lock and refuses to start when a run is already in
 * flight or the last one was too recent. A manual run skips the interval check
 * but still refuses to overlap.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { parseTikTokInput, shortCaption } from "./tiktok";
import { listSourceVideos, tiktokDiscoveryStatus } from "./tiktok.server";

const db = supabaseAdmin as unknown as SupabaseClient;

export type TikTokSyncSettings = {
  enabled: boolean;
  interval_minutes: number;
  max_per_source: number;
  owner_user_id: string | null;
  auto_publish: boolean;
};

export type TikTokSyncSummary = {
  runId: string | null;
  status: "ok" | "partial" | "error" | "skipped";
  sourcesChecked: number;
  videosAdded: number;
  videosSkipped: number;
  message: string;
};

const DEFAULT_SETTINGS: TikTokSyncSettings = {
  enabled: true,
  interval_minutes: 15,
  max_per_source: 5,
  owner_user_id: null,
  auto_publish: true,
};

/** Read the single settings row, falling back to sane defaults. */
export async function loadTikTokSettings(): Promise<TikTokSyncSettings> {
  const { data } = await db
    .from("tiktok_sync_settings")
    .select("enabled, interval_minutes, max_per_source, owner_user_id, auto_publish")
    .eq("id", 1)
    .maybeSingle();
  if (!data) return { ...DEFAULT_SETTINGS };
  const row = data as Partial<TikTokSyncSettings>;
  return {
    enabled: row.enabled ?? DEFAULT_SETTINGS.enabled,
    interval_minutes: row.interval_minutes ?? DEFAULT_SETTINGS.interval_minutes,
    max_per_source: row.max_per_source ?? DEFAULT_SETTINGS.max_per_source,
    owner_user_id: row.owner_user_id ?? null,
    auto_publish: row.auto_publish ?? DEFAULT_SETTINGS.auto_publish,
  };
}

/**
 * The account that owns ingested rows. `full_videos.user_id` is a foreign key
 * into auth.users, so the job needs a real account even though the videos
 * belong to their TikTok creators (which is what `username` shows).
 */
async function resolveOwner(settings: TikTokSyncSettings): Promise<string | null> {
  if (settings.owner_user_id) return settings.owner_user_id;
  const { data } = await db
    .from("user_roles")
    .select("user_id, role, created_at")
    .in("role", ["admin", "owner"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as { user_id?: string } | null)?.user_id ?? null;
}

async function finishRun(runId: string, summary: Omit<TikTokSyncSummary, "runId">): Promise<void> {
  await db
    .from("tiktok_sync_runs")
    .update({
      status: summary.status,
      finished_at: new Date().toISOString(),
      sources_checked: summary.sourcesChecked,
      videos_added: summary.videosAdded,
      videos_skipped: summary.videosSkipped,
      message: summary.message.slice(0, 2000),
    })
    .eq("id", runId);
}

export type RunTikTokSyncOptions = {
  trigger: "cron" | "manual";
  /** Manual runs ignore the "last run was too recent" guard. */
  force?: boolean;
};

export async function runTikTokSync(options: RunTikTokSyncOptions): Promise<TikTokSyncSummary> {
  const settings = await loadTikTokSettings();

  if (!settings.enabled && options.trigger === "cron") {
    return {
      runId: null,
      status: "skipped",
      sourcesChecked: 0,
      videosAdded: 0,
      videosSkipped: 0,
      message: "TikTok sync is turned off in settings.",
    };
  }

  // Claim a run slot. Cron goes through the database function (advisory lock +
  // interval guard); a manual run inserts its own row but still bails out when
  // another run is in flight.
  let runId: string | null = null;
  if (options.trigger === "cron") {
    const { data, error } = await db.rpc("tiktok_claim_run", {
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
        message: "Another run is in flight, or the last one was too recent.",
      };
    }
  } else {
    const { data: running } = await db
      .from("tiktok_sync_runs")
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
        message: "A sync is already running.",
      };
    }
    const { data: created, error } = await db
      .from("tiktok_sync_runs")
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
        message: `Could not start a run: ${error?.message ?? "unknown error"}`,
      };
    }
    runId = (created as { id: string }).id;
  }

  try {
    // `videos.user_id` is nullable, so a missing owner is no longer fatal: the
    // clip still lands in the feed and the card still shows the TikTok handle.
    // We only lose the "poster" link back to a Coolerup profile.
    const ownerId = await resolveOwner(settings);

    const { data: sourceRows, error: sourceError } = await db
      .from("tiktok_sources")
      .select("id, kind, value, label")
      .eq("enabled", true)
      .order("last_synced_at", { ascending: true, nullsFirst: true })
      .limit(50);

    if (sourceError) {
      const summary = {
        status: "error" as const,
        sourcesChecked: 0,
        videosAdded: 0,
        videosSkipped: 0,
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
      checked += 1;
      const raw =
        source.kind === "creator"
          ? `@${source.value}`
          : source.kind === "hashtag"
            ? `#${source.value}`
            : source.value;
      const ref = parseTikTokInput(raw);

      if (!ref) {
        await db
          .from("tiktok_sources")
          .update({
            last_error: "Unrecognised source value.",
            last_synced_at: new Date().toISOString(),
          })
          .eq("id", source.id);
        problems.push(`${raw}: unrecognised source`);
        continue;
      }

      const result = await listSourceVideos(ref, settings.max_per_source);

      for (const item of result.items) {
        // Dedupe on the TikTok id. The unique partial index is the real guard;
        // this check just avoids a pointless insert + error round-trip.
        const { data: existing } = await db
          .from("videos")
          .select("id")
          .eq("tiktok_id", item.id)
          .maybeSingle();
        if (existing) {
          skipped += 1;
          continue;
        }

        // Ingested clips go into the short-form feed (`videos`), not the
        // long-form library. `video_url` is the canonical TikTok share URL —
        // the card plays it through TikTok's embed, so nothing is rehosted.
        const { error: insertError } = await db.from("videos").insert({
          user_id: ownerId,
          username: item.author,
          caption: shortCaption(item.title, 300),
          video_url: item.url,
          // `hidden` is the feed's moderation flag: auto-publish off means the
          // clip lands out of the feed for an admin to review first.
          hidden: !settings.auto_publish,
          is_tiktok: true,
          tiktok_id: item.id,
          tiktok_author: item.author,
        });

        if (insertError) {
          // A unique violation means another run got there first: that is a
          // skip, not a failure.
          if (/duplicate key|unique/i.test(insertError.message)) {
            skipped += 1;
          } else {
            problems.push(`${raw}: ${insertError.message}`);
          }
          continue;
        }
        added += 1;
      }

      await db
        .from("tiktok_sources")
        .update({
          last_synced_at: new Date().toISOString(),
          last_error: result.reason ? describeReason(result.reason) : null,
        })
        .eq("id", source.id);

      if (result.reason) problems.push(`${raw}: ${describeReason(result.reason)}`);
    }

    const status: TikTokSyncSummary["status"] = problems.length === 0 ? "ok" : "partial";
    const message =
      sources.length === 0
        ? "No enabled sources yet — add a TikTok creator or video link in the admin panel."
        : problems.length === 0
          ? `Checked ${checked} source(s), added ${added}, skipped ${skipped}.`
          : `Checked ${checked} source(s), added ${added}, skipped ${skipped}. Notes: ${problems
              .slice(0, 8)
              .join("; ")}`;

    const summary = {
      status,
      sourcesChecked: checked,
      videosAdded: added,
      videosSkipped: skipped,
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
      message: err instanceof Error ? err.message : "Unexpected sync failure.",
    };
    await finishRun(runId, summary);
    return { runId, ...summary };
  }
}

/** Turn a machine reason code into something an admin can act on. */
export function describeReason(reason: string): string {
  if (reason === "no_token") return "creator discovery needs TIKTOK_ACCESS_TOKEN";
  if (reason === "hashtag_sources_need_research_api")
    return "hashtag sources need TikTok Research API access";
  if (reason === "profile_no_video_ids") return "TikTok served a login wall instead of the profile";
  if (reason === "profile_unreachable") return "could not reach the TikTok profile page";
  if (reason === "profile_metadata_unavailable")
    return "found videos but could not read their details";
  if (reason === "oembed_unavailable") return "TikTok would not describe this video";
  if (reason === "short_link_unresolved") return "could not expand the short link";
  if (reason === "no_videos") return "the account has no videos to sync";
  if (reason.startsWith("token_belongs_to_"))
    return `your token belongs to ${reason.replace("token_belongs_to_", "")}, not this creator`;
  if (reason.startsWith("display_api_"))
    return `Display API error (${reason.replace("display_api_", "")})`;
  if (reason.startsWith("profile_"))
    return `profile request failed (${reason.replace("profile_", "")})`;
  return reason;
}

export { tiktokDiscoveryStatus };
