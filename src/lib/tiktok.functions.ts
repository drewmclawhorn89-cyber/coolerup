/**
 * Admin-only server functions for the TikTok sync.
 *
 * The browser never talks to TikTok and never touches the service role key.
 * Every mutation goes through `requireSupabaseAuth` and then re-checks the
 * admin role inside the handler with `has_role`, so a valid session alone is
 * not enough to change what the app ingests.
 *
 * Server-only modules (`tiktokSync.server`) are imported lazily inside the
 * handlers so they can never be pulled into the client bundle.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  parseTikTokInput,
  splitTikTokLinks,
  type TikTokImportOutcome,
  type TikTokRef,
} from "./tiktok";

export type { TikTokImportOutcome };

type Ctx = { supabase: unknown; userId: string };

async function assertAdmin(context: Ctx): Promise<void> {
  const supabase = context.supabase as {
    rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  };
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || data !== true) throw new Error("Admins only.");
}

export type TikTokSourceRow = {
  id: string;
  kind: "creator" | "video" | "hashtag";
  value: string;
  label: string;
  enabled: boolean;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
};

export type TikTokRunRow = {
  id: string;
  trigger: "cron" | "manual";
  status: "running" | "ok" | "partial" | "error" | "skipped";
  started_at: string;
  finished_at: string | null;
  sources_checked: number;
  videos_added: number;
  videos_skipped: number;
  message: string | null;
};

export type TikTokVideoRow = {
  id: string;
  username: string | null;
  caption: string | null;
  video_url: string | null;
  tiktok_id: string | null;
  tiktok_author: string | null;
  hidden: boolean;
  created_at: string;
};

export type TikTokStatus = {
  settings: {
    enabled: boolean;
    interval_minutes: number;
    max_per_source: number;
    owner_user_id: string | null;
    auto_publish: boolean;
  };
  discovery: { displayApi: boolean; mode: "display_api" | "public_pages" };
  sources: TikTokSourceRow[];
  runs: TikTokRunRow[];
  /** The most recent clips actually sitting in the feed, so an admin can
   *  find them without scrolling the swipe feed. */
  videos: TikTokVideoRow[];
  counts: { total: number; published: number; drafts: number };
};

/** Everything the admin panel needs, in one round-trip. */
export const getTikTokStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { tiktokDiscoveryStatus } = await import("./tiktok.server");
    const { loadTikTokSettings } = await import("./tiktokSync.server");
    const db = supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient;

    const [settings, sources, runs, total, published, drafts, recentVideos] = await Promise.all([
      loadTikTokSettings(),
      db
        .from("tiktok_sources")
        .select("id, kind, value, label, enabled, last_synced_at, last_error, created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      db.from("tiktok_sync_runs").select("*").order("started_at", { ascending: false }).limit(20),
      db.from("videos").select("id", { count: "exact", head: true }).eq("is_tiktok", true),
      db
        .from("videos")
        .select("id", { count: "exact", head: true })
        .eq("is_tiktok", true)
        .eq("hidden", false),
      db
        .from("videos")
        .select("id", { count: "exact", head: true })
        .eq("is_tiktok", true)
        .eq("hidden", true),
      db
        .from("videos")
        .select("id, username, caption, video_url, tiktok_id, tiktok_author, hidden, created_at")
        .eq("is_tiktok", true)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    return {
      settings,
      discovery: tiktokDiscoveryStatus(),
      sources: (sources.data ?? []) as TikTokSourceRow[],
      runs: (runs.data ?? []) as TikTokRunRow[],
      videos: (recentVideos.data ?? []) as TikTokVideoRow[],
      counts: {
        total: total.count ?? 0,
        published: published.count ?? 0,
        drafts: drafts.count ?? 0,
      },
    } satisfies TikTokStatus;
  });

/** Add a creator, a single video, or a hashtag to the watch list. */
export const addTikTokSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { input: string }) => {
    if (typeof input?.input !== "string" || !input.input.trim())
      throw new Error("Paste a TikTok link or @handle.");
    if (input.input.length > 2048) throw new Error("That link is too long.");
    return { input: input.input.trim() };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context as Ctx);
    const ref = parseTikTokInput(data.input);
    if (!ref) throw new Error("That is not a TikTok link, @handle, or video id.");
    if (ref.kind === "short")
      throw new Error("Short links (vm.tiktok.com) expire — open it and paste the full link.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient;

    const row = toSourceRow(ref);
    const { data: created, error } = await db
      .from("tiktok_sources")
      .insert({
        kind: row.kind,
        value: row.value,
        label: data.input,
        added_by: context.userId,
      })
      .select("id, kind, value, label, enabled, last_synced_at, last_error, created_at")
      .single();

    if (error) {
      if (/duplicate key|unique/i.test(error.message))
        throw new Error("That source is already on the list.");
      throw new Error(error.message);
    }
    return created as TikTokSourceRow;
  });

/** Pause or resume one source without deleting it. */
export const setTikTokSourceEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string; enabled: boolean }) => {
    if (typeof input?.id !== "string" || !/^[0-9a-f-]{36}$/i.test(input.id))
      throw new Error("Unknown source.");
    return { id: input.id, enabled: Boolean(input.enabled) };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient;
    const { error } = await db
      .from("tiktok_sources")
      .update({ enabled: data.enabled })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteTikTokSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string }) => {
    if (typeof input?.id !== "string" || !/^[0-9a-f-]{36}$/i.test(input.id))
      throw new Error("Unknown source.");
    return { id: input.id };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient;
    const { error } = await db.from("tiktok_sources").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Change the cadence, the per-run cap, or whether new rows publish at once. */
export const updateTikTokSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      enabled?: boolean;
      interval_minutes?: number;
      max_per_source?: number;
      auto_publish?: boolean;
    }) => {
      const patch: {
        enabled?: boolean;
        auto_publish?: boolean;
        interval_minutes?: number;
        max_per_source?: number;
      } = {};
      if (typeof input?.enabled === "boolean") patch.enabled = input.enabled;
      if (typeof input?.auto_publish === "boolean") patch.auto_publish = input.auto_publish;
      if (input?.interval_minutes !== undefined) {
        const value = Math.round(Number(input.interval_minutes));
        if (!Number.isFinite(value) || value < 5 || value > 1440)
          throw new Error("Interval must be between 5 and 1440 minutes.");
        patch.interval_minutes = value;
      }
      if (input?.max_per_source !== undefined) {
        const value = Math.round(Number(input.max_per_source));
        if (!Number.isFinite(value) || value < 1 || value > 50)
          throw new Error("Per-source cap must be between 1 and 50.");
        patch.max_per_source = value;
      }
      if (Object.keys(patch).length === 0) throw new Error("Nothing to change.");
      return patch;
    },
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient;
    const { error } = await db
      .from("tiktok_sync_settings")
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Import a batch of individual TikTok video links as real feed rows.
 *
 * Accepts a blob of text (one link per line, or comma/space separated) and
 * resolves each link through oEmbed, so every row it writes has a genuine
 * `tiktok_id` and plays through TikTok's own embed player.
 */
export const importTikTokLinks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { links: string }) => {
    if (typeof input?.links !== "string" || !input.links.trim())
      throw new Error("Paste at least one TikTok video link.");
    const links = splitTikTokLinks(input.links);
    if (links.length === 0) throw new Error("Paste at least one TikTok video link.");
    if (links.length > 50) throw new Error("Import at most 50 links at a time.");
    return { links };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context as Ctx);
    const { importTikTokVideos } = await import("./tiktokSync.server");
    return importTikTokVideos(data.links);
  });

/** Run the job now, ignoring the "too soon" guard. */
export const runTikTokSyncNow = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context as Ctx);
    const { runTikTokSync } = await import("./tiktokSync.server");
    return runTikTokSync({ trigger: "manual", force: true });
  });

/** Publish a row that was ingested while auto-publish was off. */
export const publishTikTokVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { id: string }) => {
    if (typeof input?.id !== "string" || !/^[0-9a-f-]{36}$/i.test(input.id))
      throw new Error("Unknown video.");
    return { id: input.id };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context as Ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient;
    const { error } = await db
      .from("videos")
      .update({ hidden: false })
      .eq("id", data.id)
      .eq("is_tiktok", true);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

function toSourceRow(ref: TikTokRef): { kind: "creator" | "video" | "hashtag"; value: string } {
  if (ref.kind === "creator") return { kind: "creator", value: ref.handle };
  if (ref.kind === "hashtag") return { kind: "hashtag", value: ref.tag };
  if (ref.kind === "video") return { kind: "video", value: ref.id };
  throw new Error("Unsupported TikTok link.");
}
