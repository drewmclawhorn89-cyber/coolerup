import type { PaymentMethod } from "@/lib/subscriptions";

/**
 * Google Pay integration.
 *
 * Two modes, chosen at build time:
 *
 *  - Stripe configured  -> production. Google Pay returns a Stripe token that
 *    the server turns into a PaymentMethod / PaymentIntent. Requires
 *    VITE_STRIPE_PUBLISHABLE_KEY and STRIPE_SECRET_KEY.
 *  - No Stripe key      -> Google's own TEST gateway. The sheet, card picker
 *    and token flow are real, but the token cannot be charged.
 *
 * The previous version hard-coded the test gateway and sent a $0.00 FINAL
 * total when starting a trial, which Google Pay rejects outright — that is why
 * the button never completed a payment.
 */

type AnyRecord = Record<string, unknown>;

const STRIPE_PUBLISHABLE_KEY: string =
  (import.meta.env?.["VITE_STRIPE_PUBLISHABLE_KEY"] as string | undefined) ??
  (import.meta.env?.["VITE_GOOGLE_PAY_STRIPE_PUBLISHABLE_KEY"] as string | undefined) ??
  "";

/** Stripe is used whenever a publishable key is present. */
export const HAS_STRIPE = STRIPE_PUBLISHABLE_KEY.startsWith("pk_");

export const GOOGLE_PAY_ENV: "TEST" | "PRODUCTION" = HAS_STRIPE ? "PRODUCTION" : "TEST";

const GATEWAY = HAS_STRIPE ? "stripe" : "example";
const GATEWAY_MERCHANT_ID = HAS_STRIPE ? "coolerup" : "exampleGatewayMerchantId";
const SCRIPT_SRC = "https://pay.google.com/gp/p/js/pay.js";
const MERCHANT_NAME = "Coolerup";

type GooglePayWindow = Window & {
  google?: { pay?: { api?: { PaymentsClient?: new (opts: AnyRecord) => AnyRecord } } };
};

const ALLOWED_CARD_NETWORKS = ["AMEX", "DISCOVER", "MASTERCARD", "VISA"];

let scriptPromise: Promise<boolean> | null = null;

/** Injects the Google Pay JS once and resolves true when the API is usable. */
export function loadGooglePay(): Promise<boolean> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve(false);
  }
  const w = window as GooglePayWindow;
  if (w.google?.pay?.api?.PaymentsClient) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => done(Boolean(w.google?.pay?.api?.PaymentsClient)));
      existing.addEventListener("error", () => done(false));
      setTimeout(() => done(Boolean(w.google?.pay?.api?.PaymentsClient)), 4000);
      return;
    }

    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => done(Boolean(w.google?.pay?.api?.PaymentsClient));
    script.onerror = () => done(false);
    document.head.appendChild(script);
    // Never leave the button spinning forever on a blocked network.
    setTimeout(() => done(Boolean(w.google?.pay?.api?.PaymentsClient)), 6000);
  });

  return scriptPromise;
}

function paymentsClient(): AnyRecord | null {
  const w = window as GooglePayWindow;
  const Ctor = w.google?.pay?.api?.PaymentsClient;
  if (!Ctor) return null;
  return new Ctor({
    environment: GOOGLE_PAY_ENV,
    merchantInfo: {
      merchantName: MERCHANT_NAME,
      ...(HAS_STRIPE ? { merchantId: GATEWAY_MERCHANT_ID } : {}),
    },
  });
}

function baseCardPaymentMethod() {
  return {
    type: "CARD",
    parameters: {
      allowedAuthMethods: ["PAN_ONLY", "CRYPTOGRAM_3DS"],
      allowedCardNetworks: ALLOWED_CARD_NETWORKS,
      billingAddressRequired: false,
    },
  };
}

/** Tokenization spec for the configured gateway. */
function tokenizationSpecification() {
  if (HAS_STRIPE) {
    return {
      type: "PAYMENT_GATEWAY",
      parameters: {
        gateway: "stripe",
        "stripe:version": "2020-08-27",
        "stripe:publishableKey": STRIPE_PUBLISHABLE_KEY,
      },
    };
  }
  return {
    type: "PAYMENT_GATEWAY",
    parameters: { gateway: GATEWAY, gatewayMerchantId: GATEWAY_MERCHANT_ID },
  };
}

/**
 * True when this browser can actually show the Google Pay sheet.
 *
 * `existingPaymentMethodRequired: false` is essential: without it Chrome on
 * desktop (and any device with no saved card) answers "not ready to pay" and
 * the button stays disabled forever.
 */
export async function googlePayAvailable(): Promise<boolean> {
  const ok = await loadGooglePay();
  if (!ok) return false;
  const client = paymentsClient();
  if (!client) return false;
  try {
    const isReadyToPay = client["isReadyToPay"] as (
      req: AnyRecord,
    ) => Promise<{ result?: boolean } | undefined>;
    const res = await isReadyToPay({
      apiVersion: 2,
      apiVersionMinor: 0,
      existingPaymentMethodRequired: false,
      allowedPaymentMethods: [baseCardPaymentMethod()],
    });
    return Boolean(res?.result);
  } catch {
    return false;
  }
}

type TokenDetails = {
  token: string;
  last4: string;
  network: string;
  expMonth: number;
  expYear: number;
};

/** Pulls the card details out of whatever token the gateway handed back. */
function readToken(raw: string): TokenDetails {
  const fallback: TokenDetails = {
    token: raw,
    last4: "0000",
    network: "",
    expMonth: 0,
    expYear: 0,
  };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as AnyRecord;
    // Stripe token: { id: "tok_…", card: { last4, brand, exp_month, exp_year } }
    const card = parsed["card"] as AnyRecord | undefined;
    if (card) {
      const last4 = String(card["last4"] ?? "");
      return {
        token: String(parsed["id"] ?? raw),
        last4: /^\d{4}$/.test(last4) ? last4 : "0000",
        network: String(card["brand"] ?? "").toUpperCase(),
        expMonth: Number(card["exp_month"] ?? 0) || 0,
        expYear: Number(card["exp_year"] ?? 0) || 0,
      };
    }
    // Google's generic token payload.
    const flat = JSON.stringify(parsed);
    const last4 = flat.match(/"last4"\s*:\s*"(\d{4})"/)?.[1];
    const network = flat.match(/"cardNetwork"\s*:\s*"([A-Z_]+)"/)?.[1];
    return {
      token: raw,
      last4: last4 ?? "0000",
      network: network ?? "",
      expMonth: 0,
      expYear: 0,
    };
  } catch {
    const loose = raw.match(/(\d{4})(?!.*\d)/);
    return { ...fallback, last4: loose?.[1] ?? "0000" };
  }
}

export type GooglePayOutcome =
  | { ok: true; paymentMethod: PaymentMethod; token: string }
  | { ok: false; reason: "unavailable" | "cancelled" | "failed"; message?: string };

/**
 * Opens the native Google Pay sheet and returns a PaymentMethod record plus the
 * raw gateway token (the caller must send the token to the server to charge or
 * save the card).
 *
 * `price` of 0 means "save this card, charge nothing today" — the trial flow.
 * Google Pay refuses a FINAL total of 0.00, so that case uses
 * NOT_CURRENTLY_KNOWN instead.
 */
export async function requestGooglePay(price: number, label: string): Promise<GooglePayOutcome> {
  const ok = await loadGooglePay();
  const client = ok ? paymentsClient() : null;
  if (!client) return { ok: false, reason: "unavailable" };

  const savingOnly = !(price > 0);

  const transactionInfo: AnyRecord = savingOnly
    ? {
        // No money moves today: tell Google the amount is not known yet.
        totalPriceStatus: "NOT_CURRENTLY_KNOWN",
        currencyCode: "USD",
        countryCode: "US",
        transactionId: `coolerup-${Date.now()}`,
        totalPriceLabel: label,
      }
    : {
        totalPriceStatus: "FINAL",
        totalPrice: price.toFixed(2),
        currencyCode: "USD",
        countryCode: "US",
        transactionId: `coolerup-${Date.now()}`,
        totalPriceLabel: label,
      };

  const request = {
    apiVersion: 2,
    apiVersionMinor: 0,
    allowedPaymentMethods: [
      {
        ...baseCardPaymentMethod(),
        tokenizationSpecification: tokenizationSpecification(),
      },
    ],
    transactionInfo,
    merchantInfo: {
      merchantName: MERCHANT_NAME,
      ...(HAS_STRIPE ? { merchantId: GATEWAY_MERCHANT_ID } : {}),
    },
  };

  try {
    const loadPaymentData = client["loadPaymentData"] as (
      req: AnyRecord,
    ) => Promise<AnyRecord | undefined>;
    const paymentData = await loadPaymentData(request);
    if (!paymentData) return { ok: false, reason: "cancelled" };

    const methodData = (paymentData["paymentMethodData"] as AnyRecord[] | undefined)?.[0] ?? {};
    const tokenization = methodData["tokenizationData"] as AnyRecord | undefined;
    const rawToken = String(tokenization?.["token"] ?? "");
    if (!rawToken) return { ok: false, reason: "failed", message: "No payment token returned" };

    const info = (methodData["info"] as AnyRecord | undefined) ?? {};
    const details = readToken(rawToken);
    const network = (details.network || String(info["cardNetwork"] ?? "")).toUpperCase();

    const brand =
      network === "VISA"
        ? "visa"
        : network === "MASTERCARD"
          ? "mastercard"
          : network === "AMEX"
            ? "amex"
            : network === "DISCOVER"
              ? "discover"
              : "card";

    return {
      ok: true,
      token: details.token,
      paymentMethod: {
        provider: "googlepay",
        brand,
        last4: details.last4,
        expMonth: details.expMonth,
        expYear: details.expYear,
        holder: "Google Pay",
        addedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Google rejects with a statusCode string on dismissal.
    if (/CANCELED|CANCELLED/i.test(message)) return { ok: false, reason: "cancelled" };
    return { ok: false, reason: "failed", message };
  }
}
