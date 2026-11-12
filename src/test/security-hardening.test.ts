import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const migration = read("supabase/migrations/20261204000000_security_hardening.sql");
const youtube = read("src/lib/youtube.functions.ts");
const groups = read("src/lib/groups.ts");
const notify = read("src/lib/notify.ts");
const push = read("src/lib/push.functions.ts");
const coinsFn = read("src/lib/coins.functions.ts");

describe("security hardening migration", () => {
  it("only lets admins update coin balances", () => {
    expect(migration).toContain('create policy "admins update coin balances"');
    expect(migration).toContain("using (public.is_admin())");
    expect(migration).toContain(
      "revoke insert, delete on public.user_coins from anon, authenticated",
    );
  });

  it("guards the manual credit RPC behind an admin check", () => {
    expect(migration).toContain("create or replace function public.admin_credit_coins");
    expect(migration).toContain("if not public.is_admin() then");
    expect(migration).toContain("raise exception 'not_admin'");
  });

  it("blocks group members from promoting themselves", () => {
    // The old policy allowed `auth.uid() = user_id` on update; the new one must
    // require group admin for every membership change.
    expect(migration).toContain('create policy "admins update members" on public.group_members');
    expect(migration).toContain("using (public.is_group_admin(group_id))");
    expect(migration).toContain("create trigger group_member_role_guard");
    expect(migration).toContain("only a group admin can change member roles");
  });

  it("scopes full_videos writes to the row owner", () => {
    expect(migration).toContain(
      'create policy "owner updates youtube videos" on public.full_videos',
    );
    expect(migration).toContain(
      'create policy "owner inserts youtube videos" on public.full_videos',
    );
    expect(migration).toContain("auth.uid() = user_id");
  });

  it("keeps sounds public-read and owner-write", () => {
    expect(migration).toContain('create policy "public read sounds" on public.sounds');
    expect(migration).toContain('create policy "owner insert sounds" on public.sounds');
    expect(migration).toContain('create policy "owner update sounds" on public.sounds');
    expect(migration).toContain('create policy "owner delete sounds" on public.sounds');
  });

  it("restricts notification inserts to friends/followers or admins", () => {
    expect(migration).toContain("create or replace function public.can_notify");
    expect(migration).toContain('create policy "notifs insert as actor" on public.notifications');
    expect(migration).toContain("public.can_notify(target_user_id)");
  });

  it("sweeps every table for RLS and drops allow-all policies", () => {
    expect(migration).toContain("c.relrowsecurity = false");
    expect(migration).toContain("and cmd = 'ALL'");
    expect(migration).toContain("coalesce(qual, 'true') = 'true'");
    expect(migration).toContain("notify pgrst, 'reload schema'");
  });
});

describe("YouTube server functions", () => {
  it("requires auth on both duration writers", () => {
    const refresh = youtube.slice(youtube.indexOf("refreshYouTubeDurations"));
    const save = youtube.slice(youtube.indexOf("saveYouTubeDurations"));
    expect(refresh.slice(0, 400)).toContain(".middleware([requireSupabaseAuth])");
    expect(save.slice(0, 400)).toContain(".middleware([requireSupabaseAuth])");
  });

  it("scopes every duration write to the caller's user id", () => {
    expect(youtube).toContain("const userId = context.userId;");
    expect(youtube).toContain('.eq("user_id", userId)');
    // No write may be keyed only by youtube_id.
    const writes = youtube.match(/\.update\(\{ duration: seconds \}\)[\s\S]*?;/g) ?? [];
    expect(writes.length).toBeGreaterThanOrEqual(2);
    for (const write of writes) {
      expect(write).toContain('.eq("user_id", userId)');
    }
  });

  it("inserts new videos with the token user id, not a body field", () => {
    expect(youtube).toContain("user_id: userId");
    expect(youtube).not.toContain("user_id: data.userId");
  });
});

describe("group role management", () => {
  it("verifies the caller is a group admin before changing roles", () => {
    expect(groups).toContain("async function assertGroupAdmin");
    expect(groups).toContain("Only a group admin can manage members.");
    const setRole = groups.slice(groups.indexOf("export async function setMemberRole"));
    expect(setRole.slice(0, 500)).toContain("await assertGroupAdmin(groupId)");
    expect(setRole).toContain("You can't change your own role.");
  });

  it("guards approve and remove as well", () => {
    const approve = groups.slice(groups.indexOf("export async function approveMember"));
    expect(approve.slice(0, 300)).toContain("await assertGroupAdmin(groupId)");
    const remove = groups.slice(groups.indexOf("export async function removeMember"));
    expect(remove.slice(0, 300)).toContain("await assertGroupAdmin(groupId)");
  });
});

describe("notification authorization", () => {
  it("checks the follow relationship before notifying", () => {
    expect(notify).toContain("async function canNotify");
    expect(notify).toContain('rpc("can_notify"');
    expect(notify).toContain("no follow relationship with the recipient");
  });

  it("enforces the same rule server-side before pushing", () => {
    expect(push).toContain("async function canNotify");
    expect(push).toContain("You can only notify people you follow.");
  });
});

describe("coin credit", () => {
  it("exposes a server-only admin credit function", () => {
    expect(coinsFn).toContain("export const adminCreditCoins");
    expect(coinsFn).toContain(".middleware([requireSupabaseAuth])");
    expect(coinsFn).toContain('if (!profile?.is_admin) throw new Error("Admins only.")');
    expect(coinsFn).toContain('rpc("admin_credit_coins"');
  });
});
