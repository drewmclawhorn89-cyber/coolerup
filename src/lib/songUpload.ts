import { supabase } from "@/integrations/supabase/client";
import { cacheSound, type Sound } from "@/lib/sounds";

/**
 * Uploading your own song into the Music tab.
 *
 * An uploaded song is a normal `public.sounds` row with `source = 'own'` and no
 * `original_video_id` (it doesn't come from a video). The audio file lives in
 * the public `sounds` storage bucket under `{user_id}/…`, which is exactly the
 * folder the bucket's RLS policy allows the caller to write to, and the row is
 * stamped with `user_id = auth.uid()` so only the uploader can edit or delete it.
 *
 * `audio_url` stores the bucket's public URL. `soundAudioUrl()` passes public
 * URLs straight through, so playback and offline downloads work with no extra
 * signing step.
 */

/** Storage bucket that holds uploaded audio. Mirrors the RLS migration. */
export const SONG_BUCKET = "sounds";

/**
 * Per-file cap. Keep in sync with the `sounds` bucket's `file_size_limit`
 * (26214400 bytes) set in `20261203000000_fix_sounds_rls.sql`.
 */
export const MAX_SONG_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_SONG_UPLOAD_MB = Math.round(MAX_SONG_UPLOAD_BYTES / (1024 * 1024));

/** Cover art is optional and much smaller than the audio. */
export const MAX_COVER_BYTES = 5 * 1024 * 1024;

/** What the file picker offers. */
export const AUDIO_ACCEPT = "audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac,.webm";
export const COVER_ACCEPT = "image/jpeg,image/png,image/webp";

const AUDIO_EXTENSIONS = new Set([
  "mp3",
  "m4a",
  "aac",
  "wav",
  "ogg",
  "oga",
  "opus",
  "flac",
  "webm",
  "mp4",
]);

const COVER_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

const EXT_BY_MIME: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/webm": "webm",
  "video/mp4": "m4a",
  "application/ogg": "ogg",
};

function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** Best-guess storage extension for an uploaded audio file. */
export function audioExtension(file: File): string {
  const fromName = fileExtension(file.name);
  if (AUDIO_EXTENSIONS.has(fromName)) return fromName === "oga" ? "ogg" : fromName;
  const fromMime = EXT_BY_MIME[(file.type || "").toLowerCase()];
  if (fromMime) return fromMime;
  return "mp3";
}

/** Cover extension, or null when the file isn't an accepted image. */
export function coverExtension(file: File): string | null {
  const fromName = fileExtension(file.name);
  if (COVER_EXTENSIONS.has(fromName)) return fromName === "jpeg" ? "jpg" : fromName;
  const mime = (file.type || "").toLowerCase();
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return null;
}

/**
 * Validate the chosen audio file. Returns a human-readable error, or null when
 * the file is fine. Checked before uploading so a huge file never starts.
 */
export function validateSongFile(file: File | null | undefined): string | null {
  if (!file) return "Choose an audio file first.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_SONG_UPLOAD_BYTES) {
    return `Songs must be ${MAX_SONG_UPLOAD_MB} MB or smaller.`;
  }
  const ext = fileExtension(file.name);
  const mime = (file.type || "").toLowerCase();
  const looksLikeAudio =
    mime.startsWith("audio/") ||
    mime === "video/mp4" ||
    mime === "application/ogg" ||
    AUDIO_EXTENSIONS.has(ext);
  if (!looksLikeAudio) {
    return "That doesn't look like an audio file. Pick an MP3, M4A, WAV, OGG, OPUS or FLAC.";
  }
  return null;
}

/** Validate optional cover art. Returns an error string, or null when it's fine. */
export function validateCoverFile(file: File | null | undefined): string | null {
  if (!file) return null;
  if (file.size > MAX_COVER_BYTES) return "Cover art must be 5 MB or smaller.";
  if (!coverExtension(file)) return "Cover art must be a JPG, PNG or WEBP image.";
  return null;
}

/** "my_song (1).mp3" -> "my song (1)" */
export function songTitleFromFileName(name: string): string {
  const base = (name || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (base || "My song").slice(0, 140);
}

/** "3.4 MB" for the picker summary. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** True for a song the user uploaded directly (not a video's sound, not YouTube). */
export function isUploadedSong(
  sound: Pick<Sound, "source" | "original_video_id" | "audio_url" | "user_id"> | null | undefined,
): boolean {
  if (!sound) return false;
  return (
    sound.source !== "youtube" &&
    !sound.original_video_id &&
    Boolean(sound.audio_url) &&
    Boolean(sound.user_id)
  );
}

/** Pull the object path back out of a public `sounds` bucket URL. */
export function songObjectPath(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${SONG_BUCKET}/`;
  const at = url.indexOf(marker);
  if (at === -1) return null;
  const raw =
    url
      .slice(at + marker.length)
      .split("?")[0]
      ?.split("#")[0] ?? "";
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export type UploadSongInput = {
  file: File;
  /** Optional title; falls back to the file name. */
  title?: string;
  /** Optional cover art. */
  cover?: File | null;
};

/**
 * Upload an audio file and create its `sounds` row.
 *
 * The object path is `{user_id}/{uuid}.{ext}` so the bucket policy can prove
 * ownership, and the row carries `user_id` for the same reason. If the row
 * insert fails the uploaded objects are removed so no orphans are left behind.
 */
export async function uploadSong({ file, title, cover }: UploadSongInput): Promise<Sound> {
  const invalid = validateSongFile(file);
  if (invalid) throw new Error(invalid);
  const coverInvalid = validateCoverFile(cover);
  if (coverInvalid) throw new Error(coverInvalid);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in to upload songs.");

  const { data: profile } = await supabase
    .from("profiles")
    .select("handle")
    .eq("id", user.id)
    .maybeSingle();

  const handle =
    (profile?.handle ?? "").replace(/^@/, "").trim() ||
    user.email?.split("@")[0] ||
    user.phone ||
    "you";

  const ext = audioExtension(file);
  const audioPath = `${user.id}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage.from(SONG_BUCKET).upload(audioPath, file, {
    contentType: file.type || "audio/mpeg",
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploadError) {
    throw new Error(
      uploadError.message?.toLowerCase().includes("exceeded")
        ? `That file is too big for the server. Songs must be ${MAX_SONG_UPLOAD_MB} MB or smaller.`
        : "Couldn't upload that song. Check your connection and try again.",
    );
  }

  const audioUrl = supabase.storage.from(SONG_BUCKET).getPublicUrl(audioPath).data.publicUrl;

  let coverUrl: string | null = null;
  let coverPath: string | null = null;
  if (cover) {
    const coverExt = coverExtension(cover) ?? "jpg";
    coverPath = `${user.id}/covers/${crypto.randomUUID()}.${coverExt}`;
    const { error: coverError } = await supabase.storage
      .from(SONG_BUCKET)
      .upload(coverPath, cover, {
        contentType: cover.type || `image/${coverExt}`,
        cacheControl: "31536000",
        upsert: false,
      });
    if (!coverError) {
      coverUrl = supabase.storage.from(SONG_BUCKET).getPublicUrl(coverPath).data.publicUrl;
    } else {
      // A missing cover shouldn't sink the upload — the gradient stands in.
      coverPath = null;
    }
  }

  const cleanTitle = (title ?? "").trim().slice(0, 140) || songTitleFromFileName(file.name);

  const { data: inserted, error: insertError } = await supabase
    .from("sounds")
    .insert({
      // RLS: only the owner may insert, and `user_id` must equal auth.uid().
      user_id: user.id,
      original_video_id: null,
      audio_url: audioUrl,
      title: cleanTitle,
      creator_username: handle,
      source: "own",
      uses_count: 0,
      cover_url: coverUrl,
    })
    .select("*")
    .single();

  if (insertError || !inserted) {
    // Don't leave orphaned objects in storage when the row is rejected.
    const orphans = [audioPath, coverPath].filter((p): p is string => Boolean(p));
    await supabase.storage
      .from(SONG_BUCKET)
      .remove(orphans)
      .catch(() => undefined);
    throw new Error("Couldn't save that song. Please try again.");
  }

  const sound = inserted as Sound;
  cacheSound(sound);
  return sound;
}

/** Delete one of your uploaded songs, including its stored files. */
export async function deleteUploadedSong(
  sound: Pick<Sound, "id" | "audio_url" | "cover_url">,
): Promise<void> {
  const paths = [songObjectPath(sound.audio_url), songObjectPath(sound.cover_url)].filter(
    (p): p is string => Boolean(p),
  );
  if (paths.length) {
    await supabase.storage
      .from(SONG_BUCKET)
      .remove(paths)
      .catch(() => undefined);
  }
  const { error } = await supabase.from("sounds").delete().eq("id", sound.id);
  if (error) throw new Error("Couldn't delete that song. Please try again.");
}

/** The songs you uploaded directly, newest first (for the "Your Uploads" shelf). */
export async function getMyUploadedSongs(limit = 100): Promise<Sound[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("sounds")
    .select("*")
    .eq("user_id", user.id)
    .eq("source", "own")
    .is("original_video_id", null)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(200, limit)));
  if (error) throw error;

  const songs = (data ?? []) as Sound[];
  songs.forEach(cacheSound);
  return songs;
}
