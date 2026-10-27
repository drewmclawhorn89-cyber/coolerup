import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  brandLabel,
  detectBrand,
  toPaymentMethod,
  validateCard,
  type CardErrors,
  type CardInput,
  type PaymentMethod,
} from "@/lib/subscriptions";

type Props = {
  planLabel: string;
  price: number;
  trialDays: number;
  /** Called with the validated card when the user confirms. */
  onSubmit: (pm: PaymentMethod) => void;
  onCancel: () => void;
  submitLabel?: string;
};

const EMPTY: CardInput = { holder: "", number: "", expiry: "", cvc: "" };

/** Group digits into 4s, amex into 4-6-5. */
function formatNumber(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 19);
  if (/^3[47]/.test(d)) {
    return [d.slice(0, 4), d.slice(4, 10), d.slice(10, 15)].filter(Boolean).join(" ");
  }
  return d.replace(/(.{4})/g, "$1 ").trim();
}

function formatExpiry(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}/${d.slice(2)}`;
}

export function PaymentMethodForm({
  planLabel,
  price,
  trialDays,
  onSubmit,
  onCancel,
  submitLabel,
}: Props) {
  const [input, setInput] = useState<CardInput>(EMPTY);
  const [errors, setErrors] = useState<CardErrors>({});
  const [touched, setTouched] = useState(false);

  const digits = input.number.replace(/\D/g, "");
  const brand = detectBrand(digits);

  const set = (field: keyof CardInput, value: string) => {
    const next = { ...input, [field]: value };
    setInput(next);
    if (touched) setErrors(validateCard(next));
  };

  const submit = () => {
    setTouched(true);
    const found = validateCard(input);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onSubmit(toPaymentMethod(input));
  };

  const field =
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary";

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        You won&apos;t be charged today. After your {trialDays}-day trial ends we&apos;ll charge{" "}
        <span className="font-semibold text-foreground">${price.toFixed(2)}/mo</span> for{" "}
        {planLabel}. Cancel anytime before then and you pay nothing.
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium" htmlFor="card-holder">
          Name on card
        </label>
        <input
          id="card-holder"
          className={field}
          value={input.holder}
          autoComplete="cc-name"
          onChange={(e) => set("holder", e.target.value)}
          placeholder="Alex Morgan"
        />
        {errors.holder && <p className="mt-1 text-xs text-destructive">{errors.holder}</p>}
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium" htmlFor="card-number">
          Card number
        </label>
        <div className="relative">
          <input
            id="card-number"
            className={`${field} pr-20`}
            value={input.number}
            inputMode="numeric"
            autoComplete="cc-number"
            onChange={(e) => set("number", formatNumber(e.target.value))}
            placeholder="4242 4242 4242 4242"
          />
          {digits.length >= 2 && (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
              {brandLabel(brand)}
            </span>
          )}
        </div>
        {errors.number && <p className="mt-1 text-xs text-destructive">{errors.number}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium" htmlFor="card-expiry">
            Expiry
          </label>
          <input
            id="card-expiry"
            className={field}
            value={input.expiry}
            inputMode="numeric"
            autoComplete="cc-exp"
            onChange={(e) => set("expiry", formatExpiry(e.target.value))}
            placeholder="MM/YY"
          />
          {errors.expiry && <p className="mt-1 text-xs text-destructive">{errors.expiry}</p>}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium" htmlFor="card-cvc">
            {brand === "amex" ? "CID" : "CVC"}
          </label>
          <input
            id="card-cvc"
            className={field}
            value={input.cvc}
            inputMode="numeric"
            autoComplete="cc-csc"
            maxLength={4}
            onChange={(e) => set("cvc", e.target.value.replace(/\D/g, ""))}
            placeholder={brand === "amex" ? "1234" : "123"}
          />
          {errors.cvc && <p className="mt-1 text-xs text-destructive">{errors.cvc}</p>}
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <Button variant="ghost" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button className="flex-1" onClick={submit}>
          {submitLabel ?? `Start free trial`}
        </Button>
      </div>

      <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
        We store only the card brand and last 4 digits on this device. The full number never leaves
        your browser.
      </p>
    </div>
  );
}
