import type { PaymentMethod } from "@/lib/subscriptions";

/**
 * Google Pay integration.
 *
 * There is no payment gateway wired into this app yet, so we run the Google Pay
 * API in Google's own TEST environment against their "example" gateway. The
 * sheet, the card picker and the token flow are all real — but no money moves
 * until a real gateway (Stripe, Adyen, Braintree…) is connected and
 * GOOGLE_PAY_ENV is switched to "PRODUCTION" with that gateway's merchant id.
 */

export const GOOGLE_PAY_ENV: "TEST" | "PRODUCTION" = "TEST";
const GATEWAY = "example";
const GATEWAY_MERCHANT_ID = "exampleGatewayMerchantId";
const SCRIPT_SRC = "https://pay.google.com/gp/p/js/pay.js";
const MERCHANT_NAME = "Coolerup";

type AnyRecord = Record<string, unknown>;

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
  return new Ctor({ environment: GOOGLE_PAY_ENV, merchantInfo: { merchantName: MERCHANT_NAME } });
}

function baseCardPaymentMethod() {
  return {
    type: "CARD",
    parameters: {
      allowedAuthMethods: ["PAN_ONLY", "CRYPTOGRAM_3DS"],
      allowedCardNetworks: ALLOWED_CARD_NETWORKS,
    },
  };
}

/** True when this browser can actually show the Google Pay sheet. */
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
      allowedPaymentMethods: [baseCardPaymentMethod()],
    });
    return Boolean(res?.result);
  } catch {
    return false;
  }
}

/** Pulls the last four digits out of whatever token the gateway handed back. */
function last4FromToken(token: string): string {
  try {
    const parsed = JSON.parse(token) as AnyRecord;
    const flat = JSON.stringify(parsed);
    const tagged = flat.match(/"last4"\s*:\s*"(\d{4})"/);
    if (tagged?.[1]) return tagged[1];
    const card = flat.match(/"lastFourDigits"\s*:\s*"(\d{4})"/);
    if (card?.[1]) return card[1];
  } catch {
    // Opaque token — fall through to a generic scan.
  }
  const loose = token.match(/(\d{4})(?!.*\d)/);
  return loose?.[1] ?? "0000";
}

export type GooglePayOutcome =
  | { ok: true; paymentMethod: PaymentMethod; token: string }
  | { ok: false; reason: "unavailable" | "cancelled" | "failed"; message?: string };

/**
 * Opens the native Google Pay sheet and returns a PaymentMethod record.
 * Resolves `cancelled` when the user dismisses the sheet.
 */
export async function requestGooglePay(price: number, label: string): Promise<GooglePayOutcome> {
  const ok = await loadGooglePay();
  const client = ok ? paymentsClient() : null;
  if (!client) return { ok: false, reason: "unavailable" };

  const request = {
    apiVersion: 2,
    apiVersionMinor: 0,
    allowedPaymentMethods: [
      {
        ...baseCardPaymentMethod(),
        tokenizationSpecification: {
          type: "PAYMENT_GATEWAY",
          parameters: { gateway: GATEWAY, gatewayMerchantId: GATEWAY_MERCHANT_ID },
        },
      },
    ],
    transactionInfo: {
      totalPriceStatus: "FINAL",
      totalPrice: price.toFixed(2),
      currencyCode: "USD",
      countryCode: "US",
      transactionId: `coolerup-${Date.now()}`,
      totalPriceLabel: label,
    },
    merchantInfo: { merchantName: MERCHANT_NAME },
  };

  try {
    const loadPaymentData = client["loadPaymentData"] as (
      req: AnyRecord,
    ) => Promise<AnyRecord | undefined>;
    const paymentData = await loadPaymentData(request);
    if (!paymentData) return { ok: false, reason: "cancelled" };

    const methodData = (paymentData["paymentMethodData"] as AnyRecord[] | undefined)?.[0] ?? {};
    const tokenization = methodData["tokenizationData"] as AnyRecord | undefined;
    const token = String(tokenization?.["token"] ?? "");
    const info = (methodData["info"] as AnyRecord | undefined) ?? {};
    const network = String(info["cardNetwork"] ?? "").toUpperCase();

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
      token,
      paymentMethod: {
        provider: "googlepay",
        brand,
        last4: last4FromToken(token),
        expMonth: 0,
        expYear: 0,
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
