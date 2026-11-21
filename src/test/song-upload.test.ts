import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}));

import {
  MAX_SONG_UPLOAD_BYTES,
  audioExtension,
  isUploadedSong,
  songObjectPath,
  songTitleFromFileName,
  validateCoverFile,
  validateSongFile,
} from "@/lib/songUpload";

function fakeFile(name: string, type: string, bytes = 16): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("validateSongFile", () => {
  it("requires a file", () => {
    expect(validateSongFile(null)).toMatch(/choose an audio file/i);
  });

  it("rejects empty files", () => {
    expect(validateSongFile(fakeFile("empty.mp3", "audio/mpeg", 0))).toMatch(/empty/i);
  });

  it("rejects files over the bucket limit", () => {
    const file = fakeFile("huge.mp3", "audio/mpeg");
    Object.defineProperty(file, "size", { value: MAX_SONG_UPLOAD_BYTES + 1 });
    expect(validateSongFile(file)).toMatch(/25 MB or smaller/i);
  });

  it("rejects non-audio files", () => {
    expect(validateSongFile(fakeFile("notes.pdf", "application/pdf"))).toMatch(
      /doesn't look like an audio file/i,
    );
  });

  it("accepts common audio types", () => {
    expect(validateSongFile(fakeFile("song.mp3", "audio/mpeg"))).toBeNull();
    expect(validateSongFile(fakeFile("song.m4a", "audio/mp4"))).toBeNull();
    expect(validateSongFile(fakeFile("song.wav", "audio/wav"))).toBeNull();
    // Some pickers report an empty MIME type; the extension still counts.
    expect(validateSongFile(fakeFile("song.flac", ""))).toBeNull();
  });
});

describe("validateCoverFile", () => {
  it("allows no cover", () => {
    expect(validateCoverFile(null)).toBeNull();
  });

  it("rejects non-images", () => {
    expect(validateCoverFile(fakeFile("cover.gif", "image/gif"))).toMatch(/JPG, PNG or WEBP/i);
  });

  it("accepts jpg, png and webp", () => {
    expect(validateCoverFile(fakeFile("cover.jpg", "image/jpeg"))).toBeNull();
    expect(validateCoverFile(fakeFile("cover.png", "image/png"))).toBeNull();
    expect(validateCoverFile(fakeFile("cover.webp", "image/webp"))).toBeNull();
  });
});

describe("audioExtension", () => {
  it("prefers the file extension", () => {
    expect(audioExtension(fakeFile("My Song.MP3", "audio/mpeg"))).toBe("mp3");
    expect(audioExtension(fakeFile("song.oga", ""))).toBe("ogg");
  });

  it("falls back to the MIME type", () => {
    expect(audioExtension(fakeFile("blob", "audio/mp4"))).toBe("m4a");
    expect(audioExtension(fakeFile("blob", "audio/flac"))).toBe("flac");
  });

  it("defaults to mp3 when nothing is recognisable", () => {
    expect(audioExtension(fakeFile("blob", ""))).toBe("mp3");
  });
});

describe("songTitleFromFileName", () => {
  it("strips the extension and tidies separators", () => {
    expect(songTitleFromFileName("my_cool_song.mp3")).toBe("my cool song");
    expect(songTitleFromFileName("  Demo   Track .m4a")).toBe("Demo Track");
  });

  it("falls back when the name is empty", () => {
    expect(songTitleFromFileName("")).toBe("My song");
    expect(songTitleFromFileName(".mp3")).toBe("My song");
  });

  it("caps the title at 140 characters", () => {
    expect(songTitleFromFileName(`${"a".repeat(300)}.mp3`)).toHaveLength(140);
  });
});

describe("songObjectPath", () => {
  it("recovers the path from a public sounds URL", () => {
    expect(
      songObjectPath(
        "https://x.supabase.co/storage/v1/object/public/sounds/user-1/track.mp3?token=abc",
      ),
    ).toBe("user-1/track.mp3");
  });

  it("decodes percent-escaped paths", () => {
    expect(
      songObjectPath("https://x.supabase.co/storage/v1/object/public/sounds/user-1/a%20b.mp3"),
    ).toBe("user-1/a b.mp3");
  });

  it("ignores other buckets and empty values", () => {
    expect(songObjectPath("https://x.supabase.co/storage/v1/object/public/videos/a.mp4")).toBeNull();
    expect(songObjectPath("storage:user-1/a.mp3")).toBeNull();
    expect(songObjectPath(null)).toBeNull();
  });
});

describe("isUploadedSong", () => {
  it("is true only for owned, non-video, non-YouTube songs", () => {
    expect(
      isUploadedSong({
        source: "own",
        original_video_id: null,
        audio_url: "https://cdn/song.mp3",
        user_id: "user-1",
      }),
    ).toBe(true);
  });

  it("is false for video sounds, YouTube songs and library rows", () => {
    expect(
      isUploadedSong({
        source: "own",
        original_video_id: "video-1",
        audio_url: "https://cdn/song.mp3",
        user_id: "user-1",
      }),
    ).toBe(false);
    expect(
      isUploadedSong({
        source: "youtube",
        original_video_id: null,
        audio_url: "",
        user_id: "user-1",
      }),
    ).toBe(false);
    expect(
      isUploadedSong({
        source: "own",
        original_video_id: null,
        audio_url: "https://cdn/song.mp3",
        user_id: null,
      }),
    ).toBe(false);
  });
});

describe("uploadSong source contract", () => {
  const src = readFileSync(path.resolve(__dirname, "../lib/songUpload.ts"), "utf8");

  it("writes objects into the caller's folder of the sounds bucket", () => {
    expect(src).toContain('export const SONG_BUCKET = "sounds"');
    expect(src).toContain("`${user.id}/${crypto.randomUUID()}.${ext}`");
  });

  it("stamps user_id and source=own on the inserted row", () => {
    expect(src).toContain("user_id: user.id");
    expect(src).toContain('source: "own"');
    expect(src).toContain("original_video_id: null");
  });

  it("cleans up orphaned objects when the row insert fails", () => {
    expect(src).toContain(".remove(orphans)");
  });
});
