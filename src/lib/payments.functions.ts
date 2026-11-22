import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { planById, planPriceCents } from "@/lib/plans";

/**
 * Server-side payment handling.
 *
 * The client never sends a price — it sends a plan id and the gateway token it
 * got from the Google Pay sheet. The server looks the price up itself, so a
 * tampered client cannot buy VIP for a penny.
 *
 * Stripe is called over its REST API with plain `fetch` so the app does not
 * need the Stripe SDK in the bundle.
 */

const STRIPE_API = "https://api.stripe.com/v1";

function stripeKey(): string | null {
  const key = process.env["STRIPE_SECRET_KEY"];
  return key && key.startsWith("sk_") ? key : null;
}

/** True when real charges are possible. */
export function stripeConfigured(): boolean {
  return Boolean(stripeKey());
}

async function stripe(
  path: string,
  params: Record<string, string>,
  method: "POST" | "GET" = "POST",
): Promise<Record<string, unknown>> {
  const key = stripeKey();
  if (!key) throw new Error("Stripe is not configured");

  const body = new URLSearchParams(params).toString();
  const url = method === "GET" ? `${STRIPE_API}/${path}?${body}` : `${STRIPE_API}/${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2024-06-20",
    },
    ...(method === "POST" ? { body } : {}),
  });

  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const error = json["error"] as Record<string, unknown> | undefined;
    const message = String(error?.["message"] ?? `Stripe error ${res.status}`);
    throw new Error(message);
  }
  return json;
}

type CardSummary = { last4: string; brand: string; expMonth: number; expYear: number };

const EMPTY_CARD: CardSummary = { last4: "0000", brand: "CARD", expMonth: 0, expYear: 0 };

function cardSummary(pm: Record<string, unknown>): CardSummary {
  const card = (pm["card"] as Record<string, unknown> | undefined) ?? {};
  return {
    last4: String(card["last4"] ?? "0000"),
    brand: String(card["brand"] ?? "card").toUpperCase(),
    expMonth: Number(card["exp_month"] ?? 0) || 0,
    expYear: Number(card["exp_year"] ?? 0) || 0,
  };
}

/** Turns a Google Pay gateway token into a Stripe PaymentMethod. */
async function paymentMethodFromToken(token: string): Promise<Record<string, unknown>> {
  if (!/^(tok|pm)_[A-Za-z0-9_]+$/.test(token)) {
    throw new Error("That Google Pay token is not a Stripe token");
  }
  if (token.startsWith("pm_")) {
    return stripe(`payment_methods/${token}`, {}, "GET");
  }
  return stripe("payment_methods", { type: "card", "card[token]": token });
}

export type ChargeResult =
  | {
      ok: true;
      configured: true;
      status: "succeeded" | "processing";
      paymentIntentId: string;
      amountCents: number;
      card: CardSummary;
    }
  | { ok: false; configured: boolean; message: string };

/**
 * Charges the plan price immediately ("Pay now" with Google Pay).
 * The amount comes from the server-side plan table, never from the client.
 */
export const chargePlanWithGooglePay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { planId: string; paymentToken: string }) => {
    if (!d?.planId || typeof d.planId !== "string") throw new Error("Unknown plan");
    if (!d?.paymentToken || typeof d.paymentToken !== "string") {
      throw new Error("Missing payment token");
    }
    return d;
  })
  .handler(async ({ data, context }): Promise<ChargeResult> => {
    const plan = planById(data.planId);
    const amountCents = planPriceCents(data.planId);
    if (!plan || amountCents == null) {
      return { ok: false, configured: stripeConfigured(), message: "Unknown plan" };
    }

    if (!stripeConfigured()) {
      // No gateway keys. Returning `ok: true` here used to let the client record
      // a payment request for money that was never charged, so a plan could be
      // marked paid without a real transaction. Fail closed instead.
      return {
        ok: false,
        configured: false,
        message: "Card payments aren't set up yet — pay with Venmo instead.",
      };
    }

    try {
      const pm = await paymentMethodFromToken(data.paymentToken);
      const pmId = String(pm["id"]);

      const intent = await stripe("payment_intents", {
        amount: String(amountCents),
        currency: "usd",
        payment_method: pmId,
        confirm: "true",
        description: `Coolerup ${plan.label} (monthly)`,
        "automatic_payment_methods[enabled]": "false",
        "payment_method_types[0]": "card",
        "metadata[plan_id]": plan.id,
        "metadata[user_id]": context.userId,
        "metadata[source]": "google_pay",
      });

      const status = String(intent["status"]);
      if (status !== "succeeded" && status !== "processing") {
        const lastError = intent["last_payment_error"] as Record<string, unknown> | undefined;
        return {
          ok: false,
          configured: true,
          message: String(lastError?.["message"] ?? `Payment ${status}`),
        };
      }

      return {
        ok: true,
        configured: true,
        status: status === "succeeded" ? "succeeded" : "processing",
        paymentIntentId: String(intent["id"]),
        amountCents,
        card: cardSummary(pm),
      };
    } catch (err) {
      return {
        ok: false,
        configured: true,
        message: err instanceof Error ? err.message : "Payment failed",
      };
    }
  });

export type SaveCardResult =
  | { ok: true; configured: true; customerId: string; paymentMethodId: string; card: CardSummary }
  | { ok: false; configured: boolean; message: string };

/**
 * Vaults a Google Pay card without charging it, used when a subscriber swaps
 * the card on an existing plan.
 *
 * A real gateway is needed here: the card has to be vaulted so the next
 * monthly renewal can be charged.
 */
export const saveCardForTrial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { planId: string; paymentToken: string }) => {
    if (!d?.planId || typeof d.planId !== "string") throw new Error("Unknown plan");
    if (!d?.paymentToken || typeof d.paymentToken !== "string") {
      throw new Error("Missing payment token");
    }
    return d;
  })
  .handler(async ({ data, context }): Promise<SaveCardResult> => {
    const plan = planById(data.planId);
    if (!plan) return { ok: false, configured: stripeConfigured(), message: "Unknown plan" };

    if (!stripeConfigured()) {
      // Same reasoning as `chargePlanWithGooglePay`: never report a card as
      // vaulted when no gateway exists to vault it.
      return {
        ok: false,
        configured: false,
        message: "Card payments aren't set up yet — pay with Venmo instead.",
      };
    }

    try {
      const pm = await paymentMethodFromToken(data.paymentToken);
      const pmId = String(pm["id"]);

      const customer = await stripe("customers", {
        payment_method: pmId,
        "metadata[user_id]": context.userId,
        "metadata[plan_id]": plan.id,
        description: `Coolerup ${plan.label} trial`,
      });
      const customerId = String(customer["id"]);

      await stripe(`customers/${customerId}`, {
        "invoice_settings[default_payment_method]": pmId,
      });

      return {
        ok: true,
        configured: true,
        customerId,
        paymentMethodId: pmId,
        card: cardSummary(pm),
      };
    } catch (err) {
      return {
        ok: false,
        configured: true,
        message: err instanceof Error ? err.message : "Couldn't save that card",
      };
    }
  });

/** Whether the deployment can take real money — lets the UI say so honestly. */
export const paymentStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    return { configured: stripeConfigured() };
  });

/* -------------------------------------------------------------------------- */
/*  Paid videos                                                               */
/* -------------------------------------------------------------------------- */

export type VideoChargeResult =
  | { ok: true; amountCents: number; purchaseId: string; alreadyOwned: boolean }
  | { ok: false; configured: boolean; message: string };

/**
 * Buy a single paid video with a card.
 *
 * The client sends a video id and a Google Pay token, never an amount: the
 * price is read off the row here, charged through Stripe, and only then is the
 * purchase recorded by the service-role `grant_paid_video_purchase` function.
 * That ordering is what stops a tampered client from unlocking a video for free.
 */
export const chargeVideoWithGooglePay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { videoId: string; kind: "short" | "full"; paymentToken: string }) => {
    if (!d?.videoId || typeof d.videoId !== "string") throw new Error("Unknown video");
    if (d.kind !== "short" && d.kind !== "full") throw new Error("Unknown video type");
    if (!d?.paymentToken || typeof d.paymentToken !== "string") {
      throw new Error("Missing payment token");
    }
    return d;
  })
  .handler(async ({ data, context }): Promise<VideoChargeResult> => {
    const table = data.kind === "full" ? "full_videos" : "videos";
    const { data: row, error: readError } = await context.supabase
      .from(table)
      .select("is_paid, price_cents")
      .eq("id", data.videoId)
      .maybeSingle();

    if (readError || !row) {
      return {
        ok: false,
        configured: stripeConfigured(),
        message: "This video is no longer available",
      };
    }

    const priceCents = Number((row as { price_cents?: number | null }).price_cents ?? 0);
    const isPaid = Boolean((row as { is_paid?: boolean | null }).is_paid);
    if (!isPaid || priceCents <= 0) {
      return { ok: false, configured: stripeConfigured(), message: "This video is free" };
    }

    if (!stripeConfigured()) {
      return {
        ok: false,
        configured: false,
        message: "Card payments aren't set up yet — pay with Coolerup Coins instead.",
      };
    }

    try {
      const pm = await paymentMethodFromToken(data.paymentToken);
      const pmId = String(pm["id"]);

      const intent = await stripe("payment_intents", {
        amount: String(priceCents),
        currency: "usd",
        payment_method: pmId,
        confirm: "true",
        description: `Coolerup paid video (${data.kind})`,
        "automatic_payment_methods[enabled]": "false",
        "payment_method_types[0]": "card",
        "metadata[video_id]": data.videoId,
        "metadata[video_kind]": data.kind,
        "metadata[user_id]": context.userId,
        "metadata[source]": "paid_video",
      });

      const status = String(intent["status"]);
      if (status !== "succeeded" && status !== "processing") {
        const lastError = intent["last_payment_error"] as Record<string, unknown> | undefined;
        return {
          ok: false,
          configured: true,
          message: String(lastError?.["message"] ?? `Payment ${status}`),
        };
      }

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const admin = supabaseAdmin as unknown as {
        rpc: (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
      };

      const { data: granted, error: grantError } = await admin.rpc("grant_paid_video_purchase", {
        p_buyer: context.userId,
        p_video_id: data.videoId,
        p_kind: data.kind,
        p_payment_ref: String(intent["id"]),
      });

      if (grantError) {
        return { ok: false, configured: true, message: grantError.message };
      }

      const result = (Array.isArray(granted) ? granted[0] : granted) as Record<
        string,
        unknown
      > | null;
      if (!result || result["ok"] !== true) {
        return {
          ok: false,
          configured: true,
          message: String(result?.["error"] ?? "Couldn't record that purchase"),
        };
      }

      return {
        ok: true,
        amountCents: Number(result["amountCents"] ?? priceCents),
        purchaseId: String(result["purchaseId"] ?? ""),
        alreadyOwned: result["alreadyOwned"] === true,
      };
    } catch (err) {
      return {
        ok: false,
        configured: true,
        message: err instanceof Error ? err.message : "Payment failed",
      };
    }
  });
