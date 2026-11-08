/**
 * In-memory hand-off for videos that are still uploading.
 *
 * When you hit Publish we insert the row immediately so the video appears in
 * the grid and on the watch page at once, but the bytes are still in flight.
 * Until they land, there is no playable URL in storage — so we keep the local
 * `File` here and let the player read straight off the user's disk. That is why
 * publishing feels instant even though the upload is not.
 *
 * Deliberately a plain Map: this only ever needs to work in the tab that did
 * the upload, and it should not survive a reload (after a reload the row is
 * either finished or genuinely still processing server-side).
 */

export type PendingVideo = {
  file: File;
  /** Object URL of the locally captured poster frame, if we grabbed one. */
  thumbUrl: string | null;
  /** Object URL for `file`, created once and reused so we can revoke it. */
  objectUrl: string;
};

const pending = new Map<string, PendingVideo>();

export function registerPendingVideo(
  id: string,
  file: File,
  thumbUrl: string | null,
): PendingVideo {
  const existing = pending.get(id);
  if (existing) URL.revokeObjectURL(existing.objectUrl);
  const entry: PendingVideo = { file, thumbUrl, objectUrl: URL.createObjectURL(file) };
  pending.set(id, entry);
  return entry;
}

export function getPendingVideo(id: string): PendingVideo | undefined {
  return pending.get(id);
}

export function clearPendingVideo(id: string): void {
  const entry = pending.get(id);
  if (!entry) return;
  URL.revokeObjectURL(entry.objectUrl);
  pending.delete(id);
}
