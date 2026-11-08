import { useCallback, useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Saved ("Vault") state for full-length videos, shared by every surface.
 *
 * The Save button on the watch page used to be `useState(false)`, so it reset
 * on every navigation and the /videos grid had no idea a video had been saved.
 * This module keeps one set of saved ids for the whole app: the watch page, the
 * grid cards and the "Up next" rail all read the same store, so tapping Save
 * anywhere turns the button yellow everywhere that video appears.
 *
 * Writes go to public.saved_full_videos (see saved_full_videos_sql_editor.sql).
 * public.saved_videos is not reusable here — its video_id foreign key points at
 * public.videos, the vertical feed's table.
 */

const db = supabase as any;

type Snapshot = {
  ids: ReadonlySet<string>;
  /** User whose saves are in `ids`, or null when signed out / not loaded yet. */
  hydratedFor: string | null;
};

let snapshot: Snapshot = { ids: new Set(), hydratedFor: null };

const listeners = new Set<() => void>();

function publish(next: Snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Snapshot {
  return snapshot;
}

/** Ids toggled by hand while the initial fetch was in flight; never clobbered. */
const touchedDuringHydration = new Set<string>();

let hydratePromise: Promise<void> | null = null;

/** True once we've told the user the table is missing, so we don't repeat it. */
let warnedMissingTable = false;

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /relation .*saved_full_videos.* does not exist/i.test(message) ||
    (/saved_full_videos/i.test(message) && /schema cache/i.test(message))
  );
}

/**
 * Load the signed-in user's saved ids once per session. Safe to call from every
 * component that renders a Save button — concurrent calls share one request.
 */
export async function hydrateSavedFullVideos(userId: string | null): Promise<void> {
  if (!userId) {
    if (snapshot.ids.size > 0 || snapshot.hydratedFor !== null) {
      publish({ ids: new Set(), hydratedFor: null });
    }
    return;
  }
  if (snapshot.hydratedFor === userId) return;
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    const { data, error } = await db
      .from("saved_full_videos")
      .select("video_id")
      .eq("user_id", userId);

    if (error) {
      if (!isMissingTable(error)) console.warn("Could not load saved videos:", error.message);
      // Mark as hydrated so we don't retry on every render; the buttons still
      // work optimistically for this session.
      publish({ ids: snapshot.ids, hydratedFor: userId });
      return;
    }

    const ids = new Set<string>();
    for (const row of (data ?? []) as { video_id?: string }[]) {
      if (row.video_id) ids.add(String(row.video_id));
    }
    // Keep anything the user toggled while this request was in flight.
    for (const id of touchedDuringHydration) {
      if (snapshot.ids.has(id)) ids.add(id);
      else ids.delete(id);
    }
    publish({ ids, hydratedFor: userId });
  })().finally(() => {
    hydratePromise = null;
    touchedDuringHydration.clear();
  });

  return hydratePromise;
}

function applyLocal(videoId: string, on: boolean) {
  const ids = new Set(snapshot.ids);
  if (on) ids.add(videoId);
  else ids.delete(videoId);
  publish({ ids, hydratedFor: snapshot.hydratedFor });
}

/**
 * Persist a save/unsave. Updates the shared store first so the button turns
 * yellow immediately, then writes through to Postgres.
 */
export async function setFullVideoSaved(
  videoId: string,
  on: boolean,
): Promise<{ ok: boolean; persisted: boolean }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, persisted: false };

  touchedDuringHydration.add(videoId);
  applyLocal(videoId, on);

  const { error } = on
    ? await db
        .from("saved_full_videos")
        .upsert({ user_id: user.id, video_id: videoId }, { onConflict: "user_id,video_id" })
    : await db
        .from("saved_full_videos")
        .delete()
        .eq("user_id", user.id)
        .eq("video_id", videoId);

  // 23505 = already saved; the desired end state is the same, so treat as fine.
  if (!error || error.code === "23505") return { ok: true, persisted: true };

  if (isMissingTable(error)) {
    // The button stays yellow for this session so the UI doesn't ignore the tap,
    // but we say so once: nothing is stored yet.
    if (!warnedMissingTable) {
      warnedMissingTable = true;
      toast.warning("Saved for now — run saved_full_videos_sql_editor.sql in Supabase to keep it.", {
        duration: 10_000,
      });
    }
    return { ok: true, persisted: false };
  }

  console.error("Could not save video:", error);
  applyLocal(videoId, !on);
  toast.error(`Couldn't save: ${error.message}`);
  return { ok: false, persisted: false };
}

/** Whether a full video is saved, read from the shared store. */
export function useFullVideoSaved(videoId: string | null | undefined): boolean {
  const auth = useAuth();
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    void hydrateSavedFullVideos(auth.user?.id ?? null);
  }, [auth.user?.id]);

  return !!videoId && snap.ids.has(videoId);
}

/**
 * Save state plus a toggle for one video. Used by the watch page and by every
 * grid card, so a tap in either place is reflected in both.
 */
export function useFullVideoSave(videoId: string | null | undefined) {
  const auth = useAuth();
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const saved = !!videoId && snap.ids.has(videoId);

  useEffect(() => {
    void hydrateSavedFullVideos(auth.user?.id ?? null);
  }, [auth.user?.id]);

  const toggle = useCallback(async () => {
    if (!videoId) return;
    if (!auth.user) {
      void auth.signIn();
      return;
    }
    const next = !saved;
    const result = await setFullVideoSaved(videoId, next);
    if (!result.ok) return;
    toast.success(next ? "Saved to Vault" : "Removed from Vault");
  }, [auth, saved, videoId]);

  return { saved, toggle, ready: snap.hydratedFor !== null };
}
