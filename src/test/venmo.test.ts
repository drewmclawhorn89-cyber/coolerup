import { describe, expect, it } from "vitest";

import {
  REFERENCE_BODY_LENGTH,
  REFERENCE_PREFIX,
  amountString,
  buildVenmoNote,
  canSubmitVenmoPayment,
  isVenmoOrderOpen,
  makeReferenceCode,
  normalizeReferenceCode,
  normalizeVenmoHandle,
  venmoAppUrl,
  venmoPayUrl,
  venmoProfileUrl,
  venmoStatusLabel,
  venmoStatusTone,
} from "@/lib/venmo";

/** Deterministic stand-in for Math.random. */
function sequence(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

describe("makeReferenceCode", () => {
  it("always produces CU- plus six characters", () => {
    const code = makeReferenceCode();
    expect(code.startsWith(REFERENCE_PREFIX)).toBe(true);
    expect(code).toHaveLength(REFERENCE_PREFIX.length + REFERENCE_BODY_LENGTH);
  });

  it("only uses the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i += 1) {
      const body = makeReferenceCode().slice(REFERENCE_PREFIX.length);
      expect(body).toMatch(/^[2-9A-HJ-NP-Z]+$/);
    }
  });

  it("is deterministic for a fixed random source", () => {
    const random = sequence([0, 0, 0, 0, 0, 0]);
    expect(makeReferenceCode(random)).toBe("CU-222222");
  });

  it("maps the top of the range to the last alphabet character", () => {
    const random = sequence([0.999999]);
    expect(makeReferenceCode(random)).toBe("CU-ZZZZZZ");
  });

  it("survives a broken random source instead of producing undefined", () => {
    const random = sequence([Number.NaN, -5, 12]);
    const code = makeReferenceCode(random);
    expect(code).toHaveLength(REFERENCE_PREFIX.length + REFERENCE_BODY_LENGTH);
    expect(code.slice(REFERENCE_PREFIX.length)).toMatch(/^[2-9A-HJ-NP-Z]+$/);
  });

  it("produces different codes on consecutive draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(makeReferenceCode());
    expect(seen.size).toBeGreaterThan(490);
  });
});

describe("normalizeReferenceCode", () => {
  it("upper-cases and trims", () => {
    expect(normalizeReferenceCode("  cu-7k3qx9 ")).toBe("CU-7K3QX9");
  });

  it("adds the prefix when it is missing", () => {
    expect(normalizeReferenceCode("7k3qx9")).toBe("CU-7K3QX9");
  });

  it("rejects wrong lengths", () => {
    expect(normalizeReferenceCode("CU-7K3QX")).toBeNull();
    expect(normalizeReferenceCode("CU-7K3QX99")).toBeNull();
  });

  it("rejects characters that are not in the alphabet", () => {
    expect(normalizeReferenceCode("CU-0O1I2A")).toBeNull();
  });

  it("rejects empty input", () => {
    expect(normalizeReferenceCode("")).toBeNull();
    expect(normalizeReferenceCode(null)).toBeNull();
    expect(normalizeReferenceCode(undefined)).toBeNull();
  });
});

describe("normalizeVenmoHandle", () => {
  it("strips a leading @", () => {
    expect(normalizeVenmoHandle("@coolerup")).toBe("coolerup");
  });

  it("trims whitespace", () => {
    expect(normalizeVenmoHandle("  coolerup  ")).toBe("coolerup");
  });

  it("allows dashes and underscores", () => {
    expect(normalizeVenmoHandle("cool-er_up")).toBe("cool-er_up");
  });

  it("rejects handles that are too short or too long", () => {
    expect(normalizeVenmoHandle("ab")).toBeNull();
    expect(normalizeVenmoHandle("a".repeat(31))).toBeNull();
  });

  it("rejects spaces and symbols", () => {
    expect(normalizeVenmoHandle("cool erup")).toBeNull();
    expect(normalizeVenmoHandle("cool$erup")).toBeNull();
  });

  it("rejects empty input", () => {
    expect(normalizeVenmoHandle("")).toBeNull();
    expect(normalizeVenmoHandle(null)).toBeNull();
  });
});

describe("amountString", () => {
  it("formats cents with two decimals", () => {
    expect(amountString(499)).toBe("4.99");
    expect(amountString(99)).toBe("0.99");
    expect(amountString(1000)).toBe("10.00");
    expect(amountString(5)).toBe("0.05");
    expect(amountString(0)).toBe("0.00");
  });

  it("rounds and clamps junk input", () => {
    expect(amountString(499.6)).toBe("5.00");
    expect(amountString(-100)).toBe("0.00");
    expect(amountString(Number.NaN)).toBe("0.00");
  });
});

describe("buildVenmoNote", () => {
  it("puts the order code in the note", () => {
    expect(buildVenmoNote("CU-7K3QX9")).toBe("Coolerup coins CU-7K3QX9");
  });
});

describe("venmoPayUrl", () => {
  const link = { handle: "@coolerup", cents: 499, referenceCode: "CU-7K3QX9" };

  it("points at venmo.com with txn=pay", () => {
    const url = new URL(venmoPayUrl(link));
    expect(url.hostname).toBe("venmo.com");
    expect(url.searchParams.get("txn")).toBe("pay");
  });

  it("pre-fills the recipient without the @", () => {
    const url = new URL(venmoPayUrl(link));
    expect(url.searchParams.get("recipients")).toBe("coolerup");
  });

  it("pre-fills the amount and the note", () => {
    const url = new URL(venmoPayUrl(link));
    expect(url.searchParams.get("amount")).toBe("4.99");
    expect(url.searchParams.get("note")).toBe("Coolerup coins CU-7K3QX9");
  });
});

describe("venmoAppUrl", () => {
  it("uses the venmo:// scheme", () => {
    const url = venmoAppUrl({ handle: "coolerup", cents: 999, referenceCode: "CU-7K3QX9" });
    expect(url.startsWith("venmo://paycharge?")).toBe(true);
    expect(url).toContain("amount=9.99");
  });
});

describe("venmoProfileUrl", () => {
  it("links to the public profile", () => {
    expect(venmoProfileUrl("@coolerup")).toBe("https://venmo.com/u/coolerup");
  });
});

describe("status helpers", () => {
  it("labels every known status", () => {
    expect(venmoStatusLabel("awaiting_payment")).toBe("Waiting for your payment");
    expect(venmoStatusLabel("submitted")).toBe("Checking your payment");
    expect(venmoStatusLabel("paid")).toBe("Coins added");
    expect(venmoStatusLabel("rejected")).toBe("Payment not found");
    expect(venmoStatusLabel("canceled")).toBe("Canceled");
  });

  it("falls back to the raw status for unknown values", () => {
    expect(venmoStatusLabel("weird")).toBe("weird");
  });

  it("maps statuses to tones", () => {
    expect(venmoStatusTone("submitted")).toBe("pending");
    expect(venmoStatusTone("paid")).toBe("good");
    expect(venmoStatusTone("rejected")).toBe("bad");
    expect(venmoStatusTone("awaiting_payment")).toBe("muted");
  });

  it("only lets unpaid orders be submitted", () => {
    expect(canSubmitVenmoPayment("awaiting_payment")).toBe(true);
    expect(canSubmitVenmoPayment("rejected")).toBe(true);
    expect(canSubmitVenmoPayment("submitted")).toBe(false);
    expect(canSubmitVenmoPayment("paid")).toBe(false);
  });

  it("treats awaiting and submitted orders as open", () => {
    expect(isVenmoOrderOpen("awaiting_payment")).toBe(true);
    expect(isVenmoOrderOpen("submitted")).toBe(true);
    expect(isVenmoOrderOpen("paid")).toBe(false);
    expect(isVenmoOrderOpen("rejected")).toBe(false);
    expect(isVenmoOrderOpen("canceled")).toBe(false);
  });
});
