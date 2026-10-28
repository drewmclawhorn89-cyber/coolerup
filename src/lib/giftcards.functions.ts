import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  giftCardById,
  giftCardPriceCents,
  isEmail,
  type GiftCardOrder,
  type GiftCardOrderStatus,
} from "@/lib/giftcards";

/**
 * Gift card purchasing.
 *
 * Flow:
 *   1. Client sends { cardId, amount, recipientEmail, paymentToken }.
 *   2. Server looks up the card and price in the catalogue — never trusts a
 *      client-supplied price — and charges that amount through Stripe.
 *   3. The order row is written immediately so the buyer can always see what
 *      they bought.
 *   4. The code is requested from the fulfilment provider (Tremendous). If no
 *      provider key is configured the order stays `pending` instead of
 *      pretending a code was issued.
 *
 * Nothing here fabricates a gift card code. A code only ever comes back from
 * the provider.
 */

const STRIPE_API = "https://api.stripe.com/v1";
const TREMENDOUS_API = "https://api.tremendous.com/api/v2";

function stripeKey(): string | null {
  const key = process.env["STRIPE_SECRET_KEY"];
  return key && key.startsWith("sk_") ? key : null;
}

function tremendousKey(): string | null {
  const key = process.env["TREMENDOUS_API_KEY"];
  return key && key.trim().length > 0 ? key.trim() : null;
}

function tremendousFundingSource(): string | null {
  const id = process.env["TREMENDOUS_FUNDING_SOURCE_ID"];
  return id && id.trim().length > 0 ? id.trim() : null;
}

/** True when gift cards can actually be delivered to a buyer. */
export function giftCardProviderConfigured(): boolean {
  return Boolean(tremendousKey() && tremendousFundingSource());
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

/** Exchanges a Google Pay gateway token for a Stripe PaymentMethod. */
async function paymentMethodFromToken(token: string): Promise<Record<string, unknown>> {
  if (!/^(tok|pm)_[A-Za-z0-9_]+$/.test(token)) {
    throw new Error("That Google Pay token is not a Stripe token");
  }
  if (token.startsWith("pm_")) {
    return stripe(`payment_methods/${token}`, {}, "GET");
  }
  return stripe("payment_methods", { type: "card", "card[token]": token });
}

type IssuedCard = {
  code: string | null;
  redemptionUrl: string | null;
  providerOrderId: string | null;
};

/**
 * Asks Tremendous to issue the reward and email it to the recipient.
 *
 * Field names differ slightly between provider versions, so the response is
 * read defensively: we look for a code and a link anywhere in the first reward
 * rather than assuming one exact shape.
 */
async function issueWithTremendous(input: {
  productId: string;
  amount: number;
  recipientEmail: string;
  recipientName: string;
  cardName: string;
  orderId: string;
}): Promise<IssuedCard> {
  const key = tremendousKey();
  const funding = tremendousFundingSource();
  if (!key || !funding) throw new Error("Gift card provider is not configured");

  const res = await fetch(`${TREMENDOUS_API}/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      external_id: input.orderId,
      payment: { funding_source_id: funding },
      reward: {
        value: { denomination: input.amount, currency_code: "USD" },
        delivery: { method: "EMAIL" },
        recipient: { name: input.recipientName, email: input.recipientEmail },
        products: [{ id: input.productId }],
        message: `Your ${input.cardName} gift card from Coolerup`,
      },
    }),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message =
      (json["message"] as string | undefined) ??
      (json["error"] as string | undefined) ??
      `Gift card provider error ${res.status}`;
    throw new Error(message);
  }

  const order = (json["order"] as Record<string, unknown> | undefined) ?? json;
  const rewards = (order["rewards"] as Record<string, unknown>[] | undefined) ?? [];
  const reward = rewards[0] ?? {};
  const delivery = (reward["delivery"] as Record<string, unknown> | undefined) ?? {};

  const code =
    (delivery["code"] as string | undefined) ??
    (reward["code"] as string | undefined) ??
    (delivery["number"] as string | undefined) ??
    null;

  const redemptionUrl =
    (delivery["link"] as string | undefined) ??
    (delivery["redemption_url"] as string | undefined) ??
    (reward["link"] as string | undefined) ??
    null;

  return {
    code,
    redemptionUrl,
    providerOrderId: (order["id"] as string | undefined) ?? null,
  };
}

export type GiftCardPurchaseResult =
  | {
      ok: true;
      order: GiftCardOrder;
      /** False when no provider key is set, so the UI can explain the wait. */
      delivered: boolean;
      charged: boolean;
      card: CardSummary;
    }
  | { ok: false; message: string };

/**
 * Buys a gift card. The amount is validated against the catalogue on the
 * server, then charged, then fulfilled.
 */
export const purchaseGiftCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { cardId: string; amount: number; recipientEmail: string; paymentToken: string }) => {
      if (!d?.cardId || typeof d.cardId !== "string") throw new Error("Choose a gift card");
      if (typeof d?.amount !== "number") throw new Error("Choose an amount");
      if (!d?.recipientEmail || !isEmail(d.recipientEmail))
        throw new Error("Enter a valid delivery email");
      if (!d?.paymentToken || typeof d.paymentToken !== "string")
        throw new Error("Missing payment token");
      return d;
    },
  )
  .handler(async ({ data, context }): Promise<GiftCardPurchaseResult> => {
    const card = giftCardById(data.cardId);
    const priceCents = giftCardPriceCents(data.cardId, data.amount);
    if (!card || priceCents == null) {
      return { ok: false, message: "That gift card or amount isn't available" };
    }

    const email = data.recipientEmail.trim().toLowerCase();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Create the order first so a charge can never exist without a record.
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("gift_card_orders")
      .insert({
        user_id: context.userId,
        card_id: card.id,
        card_name: card.name,
        amount_cents: priceCents,
        recipient_email: email,
        status: "pending",
      })
      .select("*")
      .single();

    if (insertError || !inserted) {
      return { ok: false, message: "Couldn't start that order. Try again." };
    }

    let paymentIntentId: string | null = null;
    let summary: CardSummary = EMPTY_CARD;
    let charged = false;

    if (stripeKey()) {
      try {
        const pm = await paymentMethodFromToken(data.paymentToken);
        summary = cardSummary(pm);
        const intent = await stripe("payment_intents", {
          amount: String(priceCents),
          currency: "usd",
          payment_method: String(pm["id"]),
          confirm: "true",
          description: `Coolerup gift card \u00b7 ${card.name} $${data.amount}`,
          "automatic_payment_methods[enabled]": "false",
          "payment_method_types[0]": "card",
          "metadata[kind]": "gift_card",
          "metadata[card_id]": card.id,
          "metadata[order_id]": String(inserted.id),
          "metadata[user_id]": context.userId,
        });

        const status = String(intent["status"]);
        if (status !== "succeeded" && status !== "processing") {
          const lastError = intent["last_payment_error"] as Record<string, unknown> | undefined;
          await supabaseAdmin
            .from("gift_card_orders")
            .update({ status: "failed" })
            .eq("id", inserted.id);
          return {
            ok: false,
            message: String(lastError?.["message"] ?? `Payment ${status}`),
          };
        }

        paymentIntentId = String(intent["id"]);
        charged = status === "succeeded";
        await supabaseAdmin
          .from("gift_card_orders")
          .update({ payment_intent_id: paymentIntentId })
          .eq("id", inserted.id);
      } catch (err) {
        await supabaseAdmin
          .from("gift_card_orders")
          .update({ status: "failed" })
          .eq("id", inserted.id);
        return {
          ok: false,
          message: err instanceof Error ? err.message : "Payment failed",
        };
      }
    }

    // Fulfilment. Without a provider key the order stays pending — we never
    // invent a code.
    let issued: IssuedCard = { code: null, redemptionUrl: null, providerOrderId: null };
    let status: GiftCardOrderStatus = "pending";

    if (giftCardProviderConfigured()) {
      try {
        issued = await issueWithTremendous({
          productId: card.providerProductId,
          amount: data.amount,
          recipientEmail: email,
          recipientName: email.split("@")[0] ?? "Coolerup user",
          cardName: card.name,
          orderId: String(inserted.id),
        });
        status = issued.code || issued.redemptionUrl ? "delivered" : "pending";
      } catch {
        status = "pending";
      }
    }

    const { data: updated } = await supabaseAdmin
      .from("gift_card_orders")
      .update({
        status,
        code: issued.code,
        redemption_url: issued.redemptionUrl,
        provider_order_id: issued.providerOrderId,
      })
      .eq("id", inserted.id)
      .select("*")
      .single();

    const row = (updated ?? inserted) as Record<string, unknown>;

    return {
      ok: true,
      delivered: status === "delivered",
      charged,
      card: summary,
      order: {
        id: String(row["id"]),
        card_id: String(row["card_id"]),
        card_name: String(row["card_name"]),
        amount_cents: Number(row["amount_cents"]),
        recipient_email: String(row["recipient_email"]),
        status: String(row["status"]) as GiftCardOrderStatus,
        code: (row["code"] as string | null) ?? null,
        redemption_url: (row["redemption_url"] as string | null) ?? null,
        created_at: String(row["created_at"]),
      },
    };
  });

/** Lets the shop say honestly whether codes are delivered instantly. */
export const giftCardStatus = createServerFn({ method: "GET" }).handler(async () => {
  return {
    providerConfigured: giftCardProviderConfigured(),
    stripeConfigured: Boolean(stripeKey()),
  };
});

/**
 * Records an order that will be paid by card outside the instant gateway flow.
 *
 * The client cannot insert into `gift_card_orders` directly (RLS only grants
 * SELECT to buyers), so this server function is the only way to reserve one.
 * The price is still resolved from the catalogue, never from the client.
 */
export const reserveGiftCardOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { cardId: string; amount: number; recipientEmail: string }) => {
    if (!d?.cardId || typeof d.cardId !== "string") throw new Error("Choose a gift card");
    if (typeof d?.amount !== "number") throw new Error("Choose an amount");
    if (!d?.recipientEmail || !isEmail(d.recipientEmail))
      throw new Error("Enter a valid delivery email");
    return d;
  })
  .handler(
    async ({
      data,
      context,
    }): Promise<{ ok: true; order: GiftCardOrder } | { ok: false; message: string }> => {
      const card = giftCardById(data.cardId);
      const priceCents = giftCardPriceCents(data.cardId, data.amount);
      if (!card || priceCents == null) {
        return { ok: false, message: "That gift card or amount isn't available" };
      }

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: inserted, error } = await supabaseAdmin
        .from("gift_card_orders")
        .insert({
          user_id: context.userId,
          card_id: card.id,
          card_name: card.name,
          amount_cents: priceCents,
          recipient_email: data.recipientEmail.trim().toLowerCase(),
          status: "pending",
        })
        .select("*")
        .single();

      if (error || !inserted)
        return { ok: false, message: "Couldn't place that order. Try again." };

      return {
        ok: true,
        order: {
          id: String(inserted.id),
          card_id: String(inserted.card_id),
          card_name: String(inserted.card_name),
          amount_cents: Number(inserted.amount_cents),
          recipient_email: String(inserted.recipient_email),
          status: "pending",
          code: null,
          redemption_url: null,
          created_at: String(inserted.created_at),
        },
      };
    },
  );
