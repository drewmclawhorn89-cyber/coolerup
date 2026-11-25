import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRows, mockBannedHandles, mockMissingStatusColumn, dbCalls } = vi.hoisted(() => ({
  mockRows: [] as Array<{
    id: string;
    username: string;
    title: string;
    description: string;
    category: string;
    status?: string | null;
    user_id: string;
    created_at: string;
  }>,
  mockBannedHandles: new Set<string>(),
  mockMissingStatusColumn: { value: false },
  dbCalls: [] as Array<{
    select: string;
    filters: string[];
    range?: [number, number];
    inIds?: string[];
  }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock("@/lib/safety", () => ({
  loadBannedHandles: vi.fn(async () => mockBannedHandles),
  isBannedAuthor: (banned: Set<string>, username?: string | null) => {
    if (!username) return false;
    return banned.has(username.replace(/^@+/, "").trim().toLowerCase());
  },
}));

vi.mock("@/lib/untypedDb", () => {
  return {
    untypedDb: {
      from: (table: string) => {
        if (table !== "full_videos") {
          throw new Error(`Unexpected table in test: ${table}`);
        }
        const callRecord: {
          select: string;
          filters: string[];
          range?: [number, number];
          inIds?: string[];
        } = { select: "", filters: [] };

        let selectedCols = "*";
        let categoryEq: string | null = null;
        const orClauses: string[] = [];
        let inIds: string[] | null = null;
        let rangeBounds: [number, number] | null = null;

        const execute = () => {
          dbCalls.push({
            select: selectedCols,
            filters: [
              ...(categoryEq ? [`category=${categoryEq}`] : []),
              ...orClauses.map((c) => `or(${c})`),
            ],
            range: rangeBounds ?? undefined,
            inIds: inIds ?? undefined,
          });

          if (
            mockMissingStatusColumn.value &&
            orClauses.some((clause) => clause.includes("status.eq.ready"))
          ) {
            return Promise.resolve({
              data: null,
              error: { message: "column full_videos.status does not exist" },
            });
          }

          let results = [...mockRows];

          if (categoryEq) {
            results = results.filter((r) => r.category === categoryEq);
          }

          for (const clause of orClauses) {
            if (clause.includes("status.eq.ready")) {
              const userMatch = clause.match(/user_id\.eq\.([^,]+)/);
              const viewerId = userMatch?.[1] ?? null;
              results = results.filter(
                (r) =>
                  r.status === "ready" || r.status == null || (viewerId && r.user_id === viewerId),
              );
            } else if (clause.includes("title.ilike.%")) {
              const m = clause.match(/title\.ilike\.%([^%]+)%/);
              const needle = (m?.[1] ?? "").toLowerCase();
              results = results.filter(
                (r) =>
                  r.title.toLowerCase().includes(needle) ||
                  r.username.toLowerCase().includes(needle) ||
                  r.description.toLowerCase().includes(needle),
              );
            }
          }

          if (inIds) {
            const set = new Set(inIds);
            results = results.filter((r) => set.has(r.id));
          }

          if (rangeBounds) {
            results = results.slice(rangeBounds[0], rangeBounds[1] + 1);
          }

          return Promise.resolve({ data: results, error: null });
        };

        const builder = {
          select(cols: string) {
            selectedCols = cols;
            callRecord.select = cols;
            return builder;
          },
          order() {
            return builder;
          },
          range(from: number, to: number) {
            rangeBounds = [from, to];
            return builder;
          },
          or(expr: string) {
            orClauses.push(expr);
            return builder;
          },
          eq(col: string, val: string) {
            if (col === "category") categoryEq = val;
            return builder;
          },
          in(col: string, vals: string[]) {
            if (col === "id") inIds = vals;
            return builder;
          },
          then(resolve: (val: unknown) => unknown, reject?: (err: unknown) => unknown) {
            return execute().then(resolve, reject);
          },
        };

        return builder;
      },
    },
  };
});

import { listFullVideos, resetFullVideoOrder, shuffleFullVideos } from "@/lib/fullVideos";

function seedVideos(count: number) {
  mockRows.length = 0;
  for (let i = 0; i < count; i += 1) {
    mockRows.push({
      id: `vid-${String(i + 1).padStart(2, "0")}`,
      username: i % 5 === 0 ? "gamer_one" : `creator_${i}`,
      title: i % 2 === 0 ? `Gaming clip ${i + 1}` : `Music session ${i + 1}`,
      description: `Description for video ${i + 1}`,
      category: i % 2 === 0 ? "Gaming" : "Music",
      status: "ready",
      user_id: `user-${i}`,
      created_at: `2026-11-${String((i % 28) + 1).padStart(2, "0")}T12:00:00Z`,
    });
  }
}

describe("shuffleFullVideos", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a new array containing the exact same items without mutating the input", () => {
    const original = ["a", "b", "c", "d", "e"];
    const snapshot = [...original];
    const shuffled = shuffleFullVideos(original);

    expect(original).toEqual(snapshot);
    expect(shuffled).not.toBe(original);
    expect(shuffled).toHaveLength(original.length);
    expect([...shuffled].sort()).toEqual([...original].sort());
  });

  it("uses Math.random to produce mixed permutations", () => {
    const seq = [0.1, 0.9, 0.2, 0.8];
    let idx = 0;
    vi.spyOn(Math, "random").mockImplementation(() => seq[idx++ % seq.length]!);

    const input = [1, 2, 3, 4, 5];
    const shuffled = shuffleFullVideos(input);
    expect(shuffled).not.toEqual(input);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(input);
  });
});

describe("listFullVideos random Videos tab ordering", () => {
  beforeEach(() => {
    resetFullVideoOrder();
    mockBannedHandles.clear();
    mockMissingStatusColumn.value = false;
    dbCalls.length = 0;
    seedVideos(10);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shuffles across all matching videos and pages cleanly without duplicates or gaps", async () => {
    // Alternating random sequence produces a non-chronological shuffle
    let step = 0;
    vi.spyOn(Math, "random").mockImplementation(() => {
      step += 1;
      return (step * 0.37) % 1;
    });

    const page1 = await listFullVideos({ category: "All", search: "", limit: 4, offset: 0 });
    const page2 = await listFullVideos({ category: "All", search: "", limit: 4, offset: 4 });
    const page3 = await listFullVideos({ category: "All", search: "", limit: 4, offset: 8 });

    expect(page1).toHaveLength(4);
    expect(page2).toHaveLength(4);
    expect(page3).toHaveLength(2);

    const combinedIds = [...page1, ...page2, ...page3].map((v) => v.id);
    const originalIds = mockRows.map((v) => v.id);

    expect(new Set(combinedIds).size).toBe(10);
    expect([...combinedIds].sort()).toEqual([...originalIds].sort());
    expect(combinedIds).not.toEqual(originalIds);

    // Only one ID-scan call happened across the 3 pages
    const idScanCalls = dbCalls.filter((c) => c.select === "id, username");
    expect(idScanCalls).toHaveLength(1);
  });

  it("re-shuffles into a fresh random order on a new offset=0 load or resetFullVideoOrder()", async () => {
    const seq1 = [0.05, 0.95, 0.15, 0.85, 0.25, 0.75, 0.35, 0.65, 0.45];
    let i1 = 0;
    const randSpy = vi.spyOn(Math, "random").mockImplementation(() => seq1[i1++ % seq1.length]!);

    const firstLoad = await listFullVideos({ category: "All", limit: 10, offset: 0 });

    const seq2 = [0.91, 0.11, 0.81, 0.21, 0.71, 0.31, 0.61, 0.41, 0.51];
    let i2 = 0;
    randSpy.mockImplementation(() => seq2[i2++ % seq2.length]!);

    const secondLoad = await listFullVideos({ category: "All", limit: 10, offset: 0 });

    expect(firstLoad.map((v) => v.id)).not.toEqual(secondLoad.map((v) => v.id));
    expect([...firstLoad.map((v) => v.id)].sort()).toEqual([...secondLoad.map((v) => v.id)].sort());
  });

  it("respects category, search, and banned-author filters when shuffling", async () => {
    mockBannedHandles.add("gamer_one");
    vi.spyOn(Math, "random").mockReturnValue(0.23);

    const gaming = await listFullVideos({ category: "Gaming", limit: 20, offset: 0 });
    expect(gaming.every((v) => v.category === "Gaming")).toBe(true);
    expect(gaming.some((v) => v.username === "gamer_one")).toBe(false);
    // Gaming rows are even indices 0,2,4,6,8 -> i=0 and i=5 are gamer_one (only 0 is Gaming)
    expect(gaming).toHaveLength(4);

    const searched = await listFullVideos({
      category: "All",
      search: "session",
      limit: 20,
      offset: 0,
    });
    expect(searched.every((v) => v.title.toLowerCase().includes("session"))).toBe(true);
    expect(searched).toHaveLength(4); // i=5 (Music) is banned gamer_one
  });

  it("falls back gracefully when the status column does not exist", async () => {
    mockMissingStatusColumn.value = true;
    const res = await listFullVideos({ category: "All", limit: 20, offset: 0 });
    expect(res).toHaveLength(10);
  });
});
