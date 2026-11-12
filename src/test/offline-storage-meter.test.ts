import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const offline = readFileSync(join(root, "src/lib/offline.ts"), "utf8");
const videos = readFileSync(join(root, "src/routes/videos.tsx"), "utf8");

describe("offline storage meter", () => {
  it("exposes a 500 MB budget", () => {
    expect(offline).toMatch(/export const MAX_OFFLINE_BYTES = 500 \* 1024 \* 1024;/);
  });

  it("counts bytes from both the shorts and full-video stores", () => {
    const body = offline.slice(offline.indexOf("export async function getOfflineUsage"));
    expect(body).toContain("FULL_STORE");
    expect(body).toContain("STORE");
    expect(body).toMatch(/reduce\(\(sum, row\) => sum \+ \(row\.size \|\| 0\), 0\)/);
  });

  it("formats bytes for the meter", () => {
    const body = offline.slice(offline.indexOf("export function formatStorage"));
    expect(body).toContain('return "0 MB"');
    expect(body).toContain("GB");
    expect(body).toContain("MB");
  });

  it("clears both stores when clearing all downloads", () => {
    const body = offline.slice(offline.indexOf("export async function clearAllDownloads"));
    expect(body).toContain('tx(FULL_STORE, "readwrite", (s) => s.clear())');
    expect(body).toContain('tx(STORE, "readwrite", (s) => s.clear())');
  });

  it("renders the meter and a confirm-guarded Clear all button", () => {
    expect(videos).toContain("Offline storage:");
    expect(videos).toContain("Clear all");
    expect(videos).toMatch(/window\.confirm\(/);
    expect(videos).toContain("getOfflineUsage()");
  });
});
