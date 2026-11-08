/**
 * Subscription codes — the client side of the Netflix-style "Redeem gift card"
 * flow.
 *
 * All validation and claiming happens in the database (`redeem_subscription_code`
 * and the `admin_*` functions in the matching migration). This module only
 * normalises input, maps the code's `basic` / `premium` tier onto the app's
 * Plus / VIP plan ids, and writes the resulting grant into the local
 * subscription record so the rest of the app unlocks immediately.
 */
import { supabase } from "@/integrations/supabase/client";
import { applyCodeSubscription, type Subscription } from "@/lib/subscriptions";

export type CodePlan = "basic" | "premium";

export const CODE_PLANS: Record<CodePlan, { label: string; planId: string; emoji: string }> = {
  basic: { label: "Basic", planId: "plus", emoji: "⭐" },
  premium: { label: "Premium", planId: "vip", emoji: "👑" },
};

export function codePlanLabel(plan: string): string {
  return CODE_PLANS[plan as CodePlan]?.label ?? plan;
}

export function codePlanId(plan: string): string {
  return CODE_PLANS[plan as CodePlan]?.planId ?? "plus";
}

export type SubscriptionCode = {
  code: string;
  plan: CodePlan;
  months: number;
  max_uses: number;
  uses_count: number;
  expires_at: string | null;
  created_by: string;
  active: boolean;
  created_at: string;
};

export type RedeemError =
  "invalid" | "inactive" | "expired" | "used_up" | "already_used" | "not_signed_in" | "unknown";

export type RedeemResult =
  | {
      ok: true;
      code: string;
      plan: CodePlan;
      planId: string;
      planLabel: string;
      months: number;
      endsAt: string;
    }
  | { ok: false; error: RedeemError; message: string };

export type CodeSubscription = {
  code: string;
  plan: CodePlan;
  months: number;
  redeemed_at: string;
  ends_at: string;
};

const ERROR_MESSAGES: Record<RedeemError, string> = {
  invalid: "Invalid code",
  inactive: "This code is no longer active",
  expired: "Code expired",
  used_up: "Code already used",
  already_used: "Code already used",
  not_signed_in: "Sign in to redeem a code",
  unknown: "Couldn't redeem that code. Try again.",
};

export function redeemErrorMessage(error: RedeemError): string {
  return ERROR_MESSAGES[error] ?? ERROR_MESSAGES.unknown;
}

/** Codes are case-insensitive and forgiving about stray spaces. */
export function normalizeCode(raw: string): string {
  return raw.trim().replace(/\s+/g, "").toUpperCase();
}

/** "Jan 7" — the short date Netflix-style balances use. */
export function formatCodeEnd(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "1 month" / "3 months" */
export function monthsLabel(months: number): string {
  return `${months} month${months === 1 ? "" : "s"}`;
}

type RpcResponse = { data: unknown; error: { message: string } | null };

/**
 * The generated Supabase types don't know about the new RPCs yet, so this
 * small wrapper keeps the call sites typed without editing the generated file.
 */
async function rpc(name: string, args?: Record<string, unknown>): Promise<RpcResponse> {
  const call = supabase.rpc as unknown as (
    fn: string,
    params?: Record<string, unknown>,
  ) => Promise<RpcResponse>;
  try {
    return await call(name, args);
  } catch (error) {
    return {
      data: null,
      error: { message: error instanceof Error ? error.message : "Network error" },
    };
  }
}

/* -------------------------------------------------------------------------- */
/*  Redeem                                                                    */
/* -------------------------------------------------------------------------- */

export async function redeemCode(rawCode: string, handle?: string | null): Promise<RedeemResult> {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, error: "invalid", message: ERROR_MESSAGES.invalid };
  if (!handle) return { ok: false, error: "not_signed_in", message: ERROR_MESSAGES.not_signed_in };

  const { data, error } = await rpc("redeem_subscription_code", { _code: code });
  if (error) {
    return { ok: false, error: "unknown", message: error.message || ERROR_MESSAGES.unknown };
  }

  const row = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    code?: string;
    plan?: CodePlan;
    months?: number;
    ends_at?: string;
  };

  if (!row.ok) {
    const key = (row.error ?? "unknown") as RedeemError;
    return { ok: false, error: key, message: redeemErrorMessage(key) };
  }

  const plan = (row.plan ?? "basic") as CodePlan;
  const months = Number(row.months ?? 1);
  const endsAt = row.ends_at ?? new Date().toISOString();
  const planInfo = CODE_PLANS[plan];

  applyCodeSubscription(handle, {
    planId: planInfo.planId,
    code: row.code ?? code,
    months,
    endsAt,
  });

  return {
    ok: true,
    code: row.code ?? code,
    plan,
    planId: planInfo.planId,
    planLabel: planInfo.label,
    months,
    endsAt,
  };
}

/** Active code grants for this account, including redemptions made elsewhere. */
export async function myCodeSubscriptions(): Promise<CodeSubscription[]> {
  const { data, error } = await rpc("my_code_subscriptions");
  if (error || !Array.isArray(data)) return [];
  return data as CodeSubscription[];
}

/* -------------------------------------------------------------------------- */
/*  Admin                                                                     */
/* -------------------------------------------------------------------------- */

export type CreateCodeInput = {
  code: string;
  plan: CodePlan;
  months: number;
  maxUses: number;
  expiresAt?: string | null;
};

export type AdminResult<T> = { ok: true; value: T } | { ok: false; message: string };

const ADMIN_ERRORS: Record<string, string> = {
  not_admin: "Only @drewmclawhorn3 can manage codes",
  missing_code: "Enter a code name",
  invalid_plan: "Choose Basic or Premium",
  invalid_months: "Choose 1, 3 or 12 months",
  invalid_max_uses: "Max uses must be at least 1",
  duplicate: "That code already exists",
  not_found: "That code no longer exists",
};

function adminError(error?: string): string {
  return (error && ADMIN_ERRORS[error]) || "Something went wrong";
}

export async function adminCreateCode(
  input: CreateCodeInput,
): Promise<AdminResult<SubscriptionCode>> {
  const { data, error } = await rpc("admin_create_subscription_code", {
    _code: normalizeCode(input.code),
    _plan: input.plan,
    _months: input.months,
    _max_uses: input.maxUses,
    _expires_at: input.expiresAt || null,
  });
  if (error) return { ok: false, message: error.message };
  const row = (data ?? {}) as { ok?: boolean; error?: string; code?: SubscriptionCode };
  if (!row.ok) return { ok: false, message: adminError(row.error) };
  return { ok: true, value: row.code as SubscriptionCode };
}

export async function adminListCodes(): Promise<AdminResult<SubscriptionCode[]>> {
  const { data, error } = await rpc("admin_list_subscription_codes");
  if (error) return { ok: false, message: error.message };
  const row = (data ?? {}) as { ok?: boolean; error?: string; codes?: SubscriptionCode[] };
  if (!row.ok) return { ok: false, message: adminError(row.error) };
  return { ok: true, value: row.codes ?? [] };
}

export async function adminDeleteCode(code: string): Promise<AdminResult<null>> {
  const { data, error } = await rpc("admin_delete_subscription_code", {
    _code: normalizeCode(code),
  });
  if (error) return { ok: false, message: error.message };
  const row = (data ?? {}) as { ok?: boolean; error?: string };
  if (!row.ok) return { ok: false, message: adminError(row.error) };
  return { ok: true, value: null };
}

export async function adminSetCodeActive(
  code: string,
  active: boolean,
): Promise<AdminResult<null>> {
  const { data, error } = await rpc("admin_set_subscription_code_active", {
    _code: normalizeCode(code),
    _active: active,
  });
  if (error) return { ok: false, message: error.message };
  const row = (data ?? {}) as { ok?: boolean; error?: string };
  if (!row.ok) return { ok: false, message: adminError(row.error) };
  return { ok: true, value: null };
}

/** Convenience for the subscription screen. */
export function codeSubscriptionSummary(sub: Subscription | null): string | null {
  if (!sub || sub.source !== "code" || !sub.code) return null;
  const end = formatCodeEnd(sub.currentPeriodEnd);
  return end ? `Active via code ${sub.code} — ends ${end}` : `Active via code ${sub.code}`;
}
