import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  AGE_DOC_ACCEPT,
  AGE_DOC_MAX_BYTES,
  AGE_VERIFY_BUCKET,
  AGE_VERIFY_PENDING_MESSAGE,
  AGE_VERIFY_REJECTED_MESSAGE,
  AGE_VERIFY_REQUIRED_MESSAGE,
  ID_TYPES,
} from "@/lib/ageVerification";

/**
 * Real-ID verification: a typed birthday is self-reported, so adult content
 * only unlocks after a moderator approves a government ID. These tests pin the
 * client contract (private bucket, accepted file types, copy) and the fact that
 * the UI actually offers the check from every locked surface.
 */

describe("age verification constants", () => {
  it("stores documents in the private bucket", () => {
    expect(AGE_VERIFY_BUCKET).toBe("age-verification");
  });

  it("accepts only image documents up to 12 MB", () => {
    expect(AGE_DOC_MAX_BYTES).toBe(12 * 1024 * 1024);
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(AGE_DOC_ACCEPT).toContain(type);
    }
  });

  it("offers the four supported government IDs", () => {
    expect(ID_TYPES.map((t) => t.value)).toEqual([
      "drivers_license",
      "passport",
      "state_id",
      "national_id",
    ]);
    for (const t of ID_TYPES) expect(t.label.length).toBeGreaterThan(0);
  });

  it("has distinct, actionable copy for each state", () => {
    expect(AGE_VERIFY_REQUIRED_MESSAGE).toMatch(/verify your id/i);
    expect(AGE_VERIFY_PENDING_MESSAGE).toMatch(/reviewed/i);
    expect(AGE_VERIFY_REJECTED_MESSAGE).toMatch(/rejected/i);
  });
});

describe("age verification client wiring", () => {
  const lib = readFileSync(resolve(process.cwd(), "src/lib/ageVerification.ts"), "utf8");

  it("fails closed when the status lookup errors", () => {
    // fetchAgeVerification returns EMPTY on error, never 'approved'.
    expect(lib).toContain("EMPTY");
    expect(lib).toMatch(/if \(error\)[\s\S]{0,400}return EMPTY/);
  });

  it("uploads into the caller's own folder", () => {
    expect(lib).toContain("${userId}/");
  });

  it("calls the two RPCs by name", () => {
    expect(lib).toContain('"my_age_verification"');
    expect(lib).toContain('"submit_age_verification"');
  });
});

describe("age verification dialog", () => {
  const dialog = readFileSync(
    resolve(process.cwd(), "src/components/AgeVerificationDialog.tsx"),
    "utf8",
  );

  it("asks for an ID photo and a selfie", () => {
    expect(dialog).toContain("Photo of your ID");
    expect(dialog).toContain("Selfie holding your ID");
  });

  it("explains the privacy of the upload", () => {
    expect(dialog).toMatch(/stored privately/i);
  });

  it("keeps the black background / white text shell", () => {
    expect(dialog).toContain("#000");
    expect(dialog).toContain("#fff");
  });
});

describe("admin review wiring", () => {
  const panel = readFileSync(
    resolve(process.cwd(), "src/components/AgeVerificationAdminPanel.tsx"),
    "utf8",
  );
  const admin = readFileSync(resolve(process.cwd(), "src/routes/admin.tsx"), "utf8");

  it("lists the queue and opens documents with signed URLs", () => {
    expect(panel).toContain('"admin_age_verifications"');
    expect(panel).toContain("signedAgeDocUrl");
  });

  it("can approve or reject", () => {
    expect(panel).toContain('"admin_review_age_verification"');
    expect(panel).toContain("Approve");
    expect(panel).toContain("Reject");
  });

  it("is reachable from the admin tab strip", () => {
    expect(admin).toContain('"ageverify"');
    expect(admin).toContain("ID Checks");
    expect(admin).toContain("AgeVerificationAdminPanel");
  });
});
