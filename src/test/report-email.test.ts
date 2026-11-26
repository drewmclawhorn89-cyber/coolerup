import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { OWNER_REPORT_EMAIL, buildReportEmailContent } from "../lib/reportEmail.server";
import { REPORT_REASONS, reasonDisplayLabel } from "../lib/moderation";

const root = join(__dirname, "..", "..");
const read = (relPath: string) => readFileSync(join(root, relPath), "utf8");

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("report reasons and UI consistency", () => {
  it("exposes the exact 5 requested report categories", () => {
    expect(REPORT_REASONS.map((r) => r.label)).toEqual([
      "Spam",
      "Bullying",
      "Sexual",
      "Hate",
      "Other",
    ]);
    expect(reasonDisplayLabel("harassment")).toBe("Bullying");
    expect(reasonDisplayLabel("bullying")).toBe("Bullying");
    expect(reasonDisplayLabel("spam")).toBe("Spam");
    expect(reasonDisplayLabel("sexual")).toBe("Sexual");
    expect(reasonDisplayLabel("hate")).toBe("Hate");
    expect(reasonDisplayLabel("other")).toBe("Other");
  });

  it("uses black background and white text across Report UI surfaces", () => {
    const reportButton = read("src/components/ReportButton.tsx");
    const reportDialog = read("src/components/ReportDialog.tsx");
    const videoCard = read("src/components/VideoCard.tsx");
    const adminPage = read("src/routes/admin.tsx");

    expect(reportButton).toContain("bg-black");
    expect(reportButton).toContain("text-white");
    expect(reportButton).toContain("REPORT_REASONS");

    expect(reportDialog).toContain("bg-black");
    expect(reportDialog).toContain("text-white");
    expect(reportDialog).toContain("REPORT_REASONS");

    expect(videoCard).toContain("bg-black text-white");
    expect(videoCard).toContain("captureVideoScreenshot");

    expect(adminPage).toContain("bg-black p-1 text-white");
  });

  it("includes Report buttons on videos, comments, watch comments, and profiles", () => {
    const comments = read("src/components/Comments.tsx");
    const watch = read("src/routes/watch.$id.tsx");
    const profile = read("src/routes/u.$username.tsx");

    expect(comments).toContain('target="comment"');
    expect(watch).toContain('target="full_video"');
    expect(watch).toContain('target="comment"');
    expect(profile).toContain('target="profile"');
  });
});

describe("owner email privacy and server-only locking", () => {
  it("locks OWNER_REPORT_EMAIL to coolerup47@gmail.com only", () => {
    expect(OWNER_REPORT_EMAIL).toBe("coolerup47@gmail.com");
  });

  it("never leaks coolerup47@gmail.com in any client bundle file or .env.example", () => {
    const srcFiles = walkFiles(join(root, "src"));
    const allowedWithOwnerEmail = new Set([
      join(root, "src/lib/reportEmail.server.ts"),
      join(root, "src/test/report-email.test.ts"),
    ]);

    for (const file of srcFiles) {
      if (allowedWithOwnerEmail.has(file)) continue;
      const content = readFileSync(file, "utf8");
      expect(content, `${file} must NOT contain owner email`).not.toContain("coolerup47@gmail.com");
    }

    expect(read(".env.example")).not.toContain("coolerup47@gmail.com");
  });

  it("locks the Supabase Edge Function recipient to coolerup47@gmail.com", () => {
    const edgeFn = read("supabase/functions/send-report-email/index.ts");
    expect(edgeFn).toContain('const OWNER_REPORT_EMAIL = "coolerup47@gmail.com"');
    expect(edgeFn).toContain("to: [OWNER_REPORT_EMAIL]");
    expect(edgeFn).not.toContain("body.to");
  });

  it("requires authentication on server functions and API notify endpoint", () => {
    const fns = read("src/lib/reports.functions.ts");
    expect(fns).toMatch(
      /submitReportEmail = createServerFn\(\{ method: "POST" \}\)\s*\n\s*\.middleware\(\[requireSupabaseAuth\]\)/,
    );
    expect(fns).toMatch(
      /adminFetchReportsServer = createServerFn\(\{ method: "GET" \}\)\s*\n\s*\.middleware\(\[requireSupabaseAuth\]\)/,
    );
    expect(fns).toMatch(
      /adminModerateReportAction = createServerFn\(\{ method: "POST" \}\)\s*\n\s*\.middleware\(\[requireSupabaseAuth\]\)/,
    );

    const apiRoute = read("src/routes/api/reports/notify.ts");
    expect(apiRoute).toContain("if (!caller)");
    expect(apiRoute).toContain("401");
  });
});

describe("buildReportEmailContent", () => {
  it("formats video report with who/what/reason/time/thumbnail and inline screenshot CID", () => {
    // Minimal 1x1 JPEG base64 sample
    const sampleDataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/";
    const built = buildReportEmailContent({
      reporterUsername: "@alice",
      reportedUsername: "bob",
      targetType: "video",
      targetUrl: "https://coolerup.app/v/123",
      targetText: "Look at this post #viral",
      reason: "harassment",
      details: "Harassing caption and clip",
      timestampIso: "2026-11-22T18:30:00.000Z",
      thumbnailUrl: "https://cdn.example.com/thumb.jpg",
      screenshotDataUrl: sampleDataUrl,
    });

    expect(built.to).toBe("coolerup47@gmail.com");
    expect(built.subject).toContain("Bullying");
    expect(built.subject).toContain("@bob");
    expect(built.subject).toContain("@alice");

    expect(built.text).toContain("Who reported: @alice");
    expect(built.text).toContain("Who was reported: @bob");
    expect(built.text).toContain("What was reported: Video — https://coolerup.app/v/123");
    expect(built.text).toContain("Reported content: Look at this post #viral");
    expect(built.text).toContain("Reason: Bullying");
    expect(built.text).toContain("Details: Harassing caption and clip");
    expect(built.text).toContain("2026-11-22T18:30:00.000Z");
    expect(built.text).toContain("https://cdn.example.com/thumb.jpg");

    expect(built.html).toContain('src="cid:report-screenshot"');
    expect(built.html).toContain('src="https://cdn.example.com/thumb.jpg"');
    expect(built.attachment).toEqual({
      base64: "/9j/4AAQSkZJRgABAQEASABIAAD/",
      filename: "report-screenshot.jpg",
      contentType: "image/jpeg",
      contentId: "report-screenshot",
    });
  });

  it("ignores unsafe non-http links/thumbnails in generated email", () => {
    const built = buildReportEmailContent({
      reporterUsername: "reporter1",
      reportedUsername: "spammer",
      targetType: "comment",
      targetUrl: "javascript:alert(1)",
      targetText: "Buy cheap followers now",
      reason: "spam",
      details: null,
      timestampIso: "2026-11-22T19:00:00.000Z",
      thumbnailUrl: "javascript:alert(2)",
      screenshotDataUrl: null,
    });

    expect(built.to).toBe("coolerup47@gmail.com");
    expect(built.html).not.toContain("javascript:");
    expect(built.text).toContain("What was reported: Comment");
    expect(built.text).toContain("Buy cheap followers now");
    expect(built.attachment).toBeNull();
  });
});

describe("Admin > Reports page and SQL migrations", () => {
  it("renders Delete Post, Ban User, and Dismiss Report actions", () => {
    const admin = read("src/routes/admin.tsx");
    expect(admin).toContain("Delete Post");
    expect(admin).toContain("Ban User");
    expect(admin).toContain("Dismiss Report");
  });

  it("no longer offers the removed warning action", () => {
    const admin = read("src/routes/admin.tsx");
    expect(admin).not.toContain("Warn User");
    expect(admin).not.toContain("AI Bot Logs");
    expect(admin).not.toContain("Ban List");
  });

  it("includes both Supabase migration and SQL Editor script for report emails and actions", () => {
    expect(
      existsSync(
        join(root, "supabase/migrations/20261224000000_report_email_and_admin_actions.sql"),
      ),
    ).toBe(true);
    expect(existsSync(join(root, "supabase/sql-editor-report-emails.sql"))).toBe(true);
    const migration = read("supabase/migrations/20261224000000_report_email_and_admin_actions.sql");
    expect(migration).toContain("admin_delete_reported_post");
    expect(migration).toContain("admin_warn_user");
    expect(migration).toContain("admin_ban_for_report");
    expect(migration).toContain("email_sent");
  });
});
