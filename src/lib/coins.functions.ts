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
import {
  DEFAULT_VENMO_RECIPIENT,
  amountString,
  buildVenmoNote,
  makeReferenceCode,
  normalizeVenmoHandle,
  venmoAppUrl,
  venmoPayUrl,
} from "@/lib/venmo";

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
  venmoConfigured: boolean;
  venmoRecipient: string | null;
  packs: { id: string; coins: number; cents: number; label: string; badge?: string }[];
};

/** The Coolerup Venmo account buyers send money to, e.g. `@coolerup`. */
function venmoRecipient(): string | null {
  return (
    normalizeVenmoHandle(process.env["VENMO_RECIPIENT"]) ??
    normalizeVenmoHandle(DEFAULT_VENMO_RECIPIENT)
  );
}

export const coinPaymentStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<CoinPaymentStatus> => ({
    stripeConfigured: Boolean(stripeKey()),
    venmoConfigured: Boolean(venmoRecipient()),
    venmoRecipient: venmoRecipient(),
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
      return { ok: false, message: "Card payments aren't set up yet — pay with Venmo instead" };
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
    if (!stripeKey()) return { ok: false, message: "Card payments aren't set up yet" };

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
/*  Buy coins with Venmo                                                      */
/* -------------------------------------------------------------------------- */

export type VenmoOrderRow = {
  id: string;
  pack_id: string;
  coins: number;
  amount_cents: number;
  reference_code: string;
  status: string;
  payer_handle: string | null;
  venmo_note: string | null;
  admin_note: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminVenmoOrder = VenmoOrderRow & {
  user_id: string;
  username: string | null;
  reviewed_at: string | null;
};

export type CoinVenmoOrderResult =
  | {
      ok: true;
      orderId: string;
      referenceCode: string;
      amountCents: number;
      amountUsd: string;
      note: string;
      recipient: string;
      venmoUrl: string;
      appUrl: string;
    }
  | { ok: false; message: string };

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Start a Venmo order. The price always comes from the server-side catalogue,
 * never from the client, and the reference code is generated here so two buyers
 * can never share one.
 */
export const createCoinVenmoOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { packId: string }) => {
    if (!d?.packId || typeof d.packId !== "string") throw new Error("Choose a coin pack");
    return d;
  })
  .handler(async ({ data, context }): Promise<CoinVenmoOrderResult> => {
    const recipient = venmoRecipient();
    if (!recipient) {
      return {
        ok: false,
        message: "Venmo isn't set up yet. An admin needs to add VENMO_RECIPIENT.",
      };
    }

    const pack = packById(data.packId);
    if (!pack) return { ok: false, message: "That coin pack isn't available" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let created: { id: string; reference_code: string } | null = null;
    for (let attempt = 0; attempt < 5 && !created; attempt += 1) {
      const referenceCode = makeReferenceCode();
      const { data: row, error } = await supabaseAdmin
        .from("coin_venmo_orders")
        .insert({
          user_id: context.userId,
          pack_id: pack.id,
          coins: pack.coins,
          amount_cents: pack.cents,
          reference_code: referenceCode,
          status: "awaiting_payment",
        })
        .select("id, reference_code")
        .single();

      if (!error && row) {
        created = row;
        break;
      }
      // 23505 = duplicate reference code, just draw another one.
      if (error && error.code !== "23505") {
        return { ok: false, message: "Couldn't start that order. Try again." };
      }
    }

    if (!created) return { ok: false, message: "Couldn't start that order. Try again." };

    const link = { handle: recipient, cents: pack.cents, referenceCode: created.reference_code };

    return {
      ok: true,
      orderId: created.id,
      referenceCode: created.reference_code,
      amountCents: pack.cents,
      amountUsd: amountString(pack.cents),
      note: buildVenmoNote(created.reference_code),
      recipient,
      venmoUrl: venmoPayUrl(link),
      appUrl: venmoAppUrl(link),
    };
  });

export type VenmoSubmitResult = { ok: true; status: string } | { ok: false; message: string };

/** The buyer says "I sent it" — moves the order into the admin review queue. */
export const submitCoinVenmoPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orderId: string; payerHandle: string; venmoNote?: string }) => {
    if (!d?.orderId || typeof d.orderId !== "string") throw new Error("Missing order");
    if (!d?.payerHandle || typeof d.payerHandle !== "string") {
      throw new Error("Enter the Venmo username you paid from");
    }
    return d;
  })
  .handler(async ({ data, context }): Promise<VenmoSubmitResult> => {
    const note = data.venmoNote?.trim();
    const { data: result, error } = await context.supabase.rpc("submit_coin_venmo_payment", {
      _order_id: data.orderId,
      _payer_handle: data.payerHandle,
      _venmo_note: note ? note : undefined,
    });

    if (error) return { ok: false, message: error.message };

    const row = (result ?? {}) as { ok?: boolean; error?: string; status?: string };
    if (!row.ok) return { ok: false, message: row.error ?? "Couldn't record that payment" };
    return { ok: true, status: String(row.status ?? "submitted") };
  });

/** My own orders, newest first, so the recharge page can show status. */
export const myCoinVenmoOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<VenmoOrderRow[]> => {
    const { data, error } = await context.supabase.rpc("my_coin_venmo_orders");
    if (error) return [];
    return asArray<VenmoOrderRow>(data);
  });

/* -------------------------------------------------------------------------- */
/*  Admin: review Venmo orders                                                */
/* -------------------------------------------------------------------------- */

export const adminCoinVenmoOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminVenmoOrder[]> => {
    const { data, error } = await context.supabase.rpc("admin_coin_venmo_orders", { _limit: 200 });
    if (error) throw new Error(error.message);
    return asArray<AdminVenmoOrder>(data);
  });

export type VenmoReviewResult =
  | { ok: true; coins: number; balance: number; alreadyPaid: boolean }
  | { ok: false; message: string };

export const adminReviewCoinVenmoOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orderId: string; action: "approve" | "reject"; note?: string }) => {
    if (!d?.orderId || typeof d.orderId !== "string") throw new Error("Missing order");
    if (d.action !== "approve" && d.action !== "reject") throw new Error("Unknown action");
    return d;
  })
  .handler(async ({ data, context }): Promise<VenmoReviewResult> => {
    const note = data.note?.trim();
    const { data: result, error } = await context.supabase.rpc("admin_review_coin_venmo_order", {
      _order_id: data.orderId,
      _action: data.action,
      _note: note ? note : undefined,
    });

    if (error) return { ok: false, message: error.message };

    const row = (result ?? {}) as {
      ok?: boolean;
      error?: string;
      coins?: number;
      balance?: number;
      alreadyPaid?: boolean;
    };
    if (!row.ok) return { ok: false, message: row.error ?? "Couldn't review that order" };

    return {
      ok: true,
      coins: Number(row.coins ?? 0),
      balance: Number(row.balance ?? 0),
      alreadyPaid: Boolean(row.alreadyPaid),
    };
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
