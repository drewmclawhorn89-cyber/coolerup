import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  COIN_PACKS,
  MIN_CASHOUT_DIAMONDS,
  centsFromDiamonds,
  coinsFromDiamonds,
  packById,
} from "@/lib/coins";

/**
 * Coin purchasing and streamer cashouts.
 *
 * Coins are bought with real money through Stripe Checkout, so card details
 * never touch Coolerup. The flow is:
 *
 *   1. `createCoinCheckout` writes a `pending` purchase row and asks Stripe for
 *      a hosted Checkout URL. The price comes from the server-side catalogue,
 *      never from the client.
 *   2. The buyer pays on Stripe.
 *   3. Stripe redirects back to /coins/recharge?session_id=...
 *   4. `confirmCoinPurchase` re-reads that session from Stripe, checks it is
 *      actually paid and belongs to the caller, then credits the wallet exactly
 *      once (the purchase row moves pending -> paid).
 *
 * Without STRIPE_SECRET_KEY nothing is charged and nothing is credited; the UI
 * says payments aren't configured instead of pretending.
 */

const STRIPE_API = "https://api.stripe.com/v1";

function stripeKey(): string | null {
  const key = process.env["STRIPE_SECRET_KEY"];
  return key && key.startsWith("sk_") ? key : null;
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
    throw new Error(String(error?.["message"] ?? `Stripe error ${res.status}`));
  }
  return json;
}

/** Where Stripe should send the buyer back to. */
function appOrigin(): string {
  const configured = process.env["APP_URL"] ?? process.env["VITE_APP_URL"];
  if (configured && /^https?:\/\//.test(configured)) return configured.replace(/\/+$/, "");
  try {
    const request = getRequest();
    const headers = request?.headers;
    const origin = headers?.get("origin");
    if (origin && /^https?:\/\//.test(origin)) return origin.replace(/\/+$/, "");
    const referer = headers?.get("referer");
    if (referer) return new URL(referer).origin;
  } catch {
    // getRequest throws outside a request scope; fall through.
  }
  return "https://coolerup.lovable.app";
}

/* -------------------------------------------------------------------------- */
/*  Status                                                                    */
/* -------------------------------------------------------------------------- */

export type CoinPaymentStatus = {
  stripeConfigured: boolean;
  packs: { id: string; coins: number; cents: number; label: string; badge?: string }[];
};

export const coinPaymentStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<CoinPaymentStatus> => ({
    stripeConfigured: Boolean(stripeKey()),
    packs: COIN_PACKS.map(({ id, coins, cents, label, badge }) => ({
      id,
      coins,
      cents,
      label,
      ...(badge ? { badge } : {}),
    })),
  }),
);

/* -------------------------------------------------------------------------- */
/*  Buy coins                                                                 */
/* -------------------------------------------------------------------------- */

export type CoinCheckoutResult =
  { ok: true; url: string; purchaseId: string } | { ok: false; message: string };

export const createCoinCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { packId: string }) => {
    if (!d?.packId || typeof d.packId !== "string") throw new Error("Choose a coin pack");
    return d;
  })
  .handler(async ({ data, context }): Promise<CoinCheckoutResult> => {
    const pack = packById(data.packId);
    if (!pack) return { ok: false, message: "That coin pack isn't available" };
    if (!stripeKey()) {
      return { ok: false, message: "Coin purchases aren't configured yet" };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Record the attempt first so a charge can never exist without a receipt.
    const { data: purchase, error: insertError } = await supabaseAdmin
      .from("coin_purchases")
      .insert({
        user_id: context.userId,
        pack_id: pack.id,
        coins: pack.coins,
        amount_cents: pack.cents,
        status: "pending",
      })
      .select("id")
      .single();

    if (insertError || !purchase) {
      return { ok: false, message: "Couldn't start that purchase. Try again." };
    }

    const origin = appOrigin();

    try {
      const session = await stripe("checkout/sessions", {
        mode: "payment",
        "payment_method_types[0]": "card",
        client_reference_id: context.userId,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": String(pack.cents),
        "line_items[0][price_data][product_data][name]": `${pack.coins.toLocaleString()} Coolerup coins`,
        "line_items[0][price_data][product_data][description]": "LIVE gift coins",
        success_url: `${origin}/coins/recharge?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/coins/recharge?canceled=1`,
        "metadata[kind]": "coin_purchase",
        "metadata[user_id]": context.userId,
        "metadata[pack_id]": pack.id,
        "metadata[purchase_id]": String(purchase.id),
      });

      const url = String(session["url"] ?? "");
      const sessionId = String(session["id"] ?? "");
      if (!url || !sessionId) {
        throw new Error("Stripe didn't return a checkout link");
      }

      await supabaseAdmin
        .from("coin_purchases")
        .update({ stripe_session_id: sessionId })
        .eq("id", purchase.id);

      return { ok: true, url, purchaseId: String(purchase.id) };
    } catch (err) {
      await supabaseAdmin.from("coin_purchases").update({ status: "failed" }).eq("id", purchase.id);
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Couldn't open checkout",
      };
    }
  });

/* -------------------------------------------------------------------------- */
/*  Confirm after Stripe redirects back                                       */
/* -------------------------------------------------------------------------- */

export type CoinConfirmResult =
  | { ok: true; coins: number; balance: number; alreadyCredited: boolean }
  | { ok: false; message: string };

export const confirmCoinPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { sessionId: string }) => {
    if (!d?.sessionId || typeof d.sessionId !== "string" || !d.sessionId.startsWith("cs_")) {
      throw new Error("Missing checkout session");
    }
    return d;
  })
  .handler(async ({ data, context }): Promise<CoinConfirmResult> => {
    if (!stripeKey()) return { ok: false, message: "Coin purchases aren't configured yet" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let session: Record<string, unknown>;
    try {
      session = await stripe(`checkout/sessions/${encodeURIComponent(data.sessionId)}`, {}, "GET");
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Couldn't read that payment",
      };
    }

    const metadata = (session["metadata"] as Record<string, unknown> | undefined) ?? {};
    if (String(metadata["user_id"] ?? "") !== context.userId) {
      return { ok: false, message: "That payment belongs to a different account" };
    }
    if (String(session["payment_status"] ?? "") !== "paid") {
      return { ok: false, message: "That payment hasn't completed yet" };
    }

    const { data: purchase } = await supabaseAdmin
      .from("coin_purchases")
      .select("id, user_id, coins, status")
      .eq("stripe_session_id", data.sessionId)
      .maybeSingle();

    if (!purchase || purchase.user_id !== context.userId) {
      return { ok: false, message: "Couldn't find that purchase" };
    }

    const { data: wallet } = await supabaseAdmin
      .from("user_coins")
      .select("balance, total_recharged")
      .eq("user_id", context.userId)
      .maybeSingle();

    if (purchase.status === "paid") {
      return {
        ok: true,
        coins: purchase.coins,
        balance: Number(wallet?.balance ?? 0),
        alreadyCredited: true,
      };
    }

    // Claim the row first: only one caller can move pending -> paid, so a
    // double redirect can never credit the wallet twice.
    const { data: claimed } = await supabaseAdmin
      .from("coin_purchases")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", purchase.id)
      .eq("status", "pending")
      .select("id");

    if (!claimed || claimed.length === 0) {
      return {
        ok: true,
        coins: purchase.coins,
        balance: Number(wallet?.balance ?? 0),
        alreadyCredited: true,
      };
    }

    const nextBalance = Number(wallet?.balance ?? 0) + purchase.coins;
    const { error: walletError } = await supabaseAdmin.from("user_coins").upsert(
      {
        user_id: context.userId,
        balance: nextBalance,
        total_recharged: Number(wallet?.total_recharged ?? 0) + purchase.coins,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    if (walletError) {
      // Put the purchase back so the next visit can retry the credit.
      await supabaseAdmin
        .from("coin_purchases")
        .update({ status: "pending", paid_at: null })
        .eq("id", purchase.id);
      return { ok: false, message: "Payment went through but coins didn't land. Try again." };
    }

    return { ok: true, coins: purchase.coins, balance: nextBalance, alreadyCredited: false };
  });

/* -------------------------------------------------------------------------- */
/*  Streamer cashout                                                          */
/* -------------------------------------------------------------------------- */

export type CashoutResult =
  { ok: true; diamonds: number; cents: number } | { ok: false; message: string };

export const requestCashout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { diamonds: number }) => {
    if (!Number.isFinite(d?.diamonds) || d.diamonds <= 0) throw new Error("Choose an amount");
    return { diamonds: Math.floor(d.diamonds) };
  })
  .handler(async ({ data, context }): Promise<CashoutResult> => {
    if (data.diamonds < MIN_CASHOUT_DIAMONDS) {
      return { ok: false, message: `Minimum cashout is ${MIN_CASHOUT_DIAMONDS} diamonds` };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: wallet } = await supabaseAdmin
      .from("user_coins")
      .select("diamonds")
      .eq("user_id", context.userId)
      .maybeSingle();

    const available = Number(wallet?.diamonds ?? 0);
    if (available < data.diamonds) {
      return { ok: false, message: "Not enough diamonds yet" };
    }

    const cents = centsFromDiamonds(data.diamonds);
    const coins = coinsFromDiamonds(data.diamonds);

    const { data: claimed } = await supabaseAdmin
      .from("user_coins")
      .update({ diamonds: available - data.diamonds, updated_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .eq("diamonds", available)
      .select("user_id");

    if (!claimed || claimed.length === 0) {
      return { ok: false, message: "That balance just changed. Try again." };
    }

    const { error } = await supabaseAdmin.from("coin_cashouts").insert({
      user_id: context.userId,
      diamonds: data.diamonds,
      coins,
      amount_cents: cents,
      status: "pending",
    });

    if (error) {
      await supabaseAdmin
        .from("user_coins")
        .update({ diamonds: available })
        .eq("user_id", context.userId);
      return { ok: false, message: "Couldn't start that cashout" };
    }

    return { ok: true, diamonds: data.diamonds, cents };
  });
