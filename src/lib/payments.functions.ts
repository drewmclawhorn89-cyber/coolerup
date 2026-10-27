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
  | { ok: true; configured: false; status: "recorded"; amountCents: number; card: CardSummary }
  | { ok: false; configured: boolean; message: string };

/**
 * Charges the plan price immediately ("Pay now" with Google Pay).
 * The amount comes from the server-side plan table, never from the client.
 */
export const chargePlanWithGooglePay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { planId: string; paymentToken: string }) => {
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
      // No gateway keys: the sheet still worked, so record the intent rather
      // than pretending a charge happened.
      return { ok: true, configured: false, status: "recorded", amountCents, card: EMPTY_CARD };
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
  | { ok: true; configured: false; card: CardSummary }
  | { ok: false; configured: boolean; message: string };

/**
 * Saves the Google Pay card for the free trial without charging it.
 *
 * A real gateway is needed here: the card has to be vaulted so the first
 * monthly charge can happen when the trial ends.
 */
export const saveCardForTrial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { planId: string; paymentToken: string }) => {
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
      return { ok: true, configured: false, card: EMPTY_CARD };
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
export const paymentStatus = createServerFn({ method: "GET" }).handler(async () => {
  return { configured: stripeConfigured() };
});
