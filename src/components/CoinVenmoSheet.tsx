import { useEffect, useState } from "react";
import { ArrowUpRight, Check, Copy, Loader2, ShieldCheck, Smartphone, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { submitCoinVenmoPayment, type CoinVenmoOrderResult } from "@/lib/coins.functions";
import { normalizeVenmoHandle, venmoProfileUrl } from "@/lib/venmo";

type ReadyOrder = Extract<CoinVenmoOrderResult, { ok: true }>;

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const el = document.createElement("textarea");
    el.value = value;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <div className="rounded-2xl border border-border bg-background p-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate font-mono text-sm font-bold">{value}</code>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="shrink-0 gap-1.5"
          onClick={() => {
            void copyText(value).then((ok) => {
              if (ok) {
                setCopied(true);
                toast.success(`${label} copied`);
              } else {
                toast.error("Couldn't copy — select it by hand");
              }
            });
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

export function CoinVenmoSheet({
  order,
  open,
  onOpenChange,
  onSubmitted,
}: {
  order: ReadyOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitted: () => void;
}) {
  const [handle, setHandle] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) {
      setHandle("");
      setNote("");
      setDone(false);
      setBusy(false);
    }
  }, [open]);

  if (!order) return null;

  const handleError = handle.trim() ? normalizeVenmoHandle(handle) === null : false;

  async function submit() {
    if (!order) return;
    const clean = normalizeVenmoHandle(handle);
    if (!clean) {
      toast.error("Enter the Venmo username you paid from");
      return;
    }

    const payload: { orderId: string; payerHandle: string; venmoNote?: string } = {
      orderId: order.orderId,
      payerHandle: clean,
    };
    const trimmed = note.trim();
    if (trimmed) payload.venmoNote = trimmed;

    setBusy(true);
    try {
      const result = await submitCoinVenmoPayment({ data: payload });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setDone(true);
      onSubmitted();
    } catch {
      toast.error("Couldn't record that payment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className="max-h-[88dvh] border-t border-border bg-background focus:outline-none"
        aria-describedby={undefined}
      >
        <DrawerTitle className="sr-only">Pay with Venmo</DrawerTitle>
        <DrawerDescription className="sr-only">
          Send {order.amountUsd} to {order.recipient} on Venmo with your order code in the note.
        </DrawerDescription>

        <div className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-muted" />

        <div className="overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-display text-2xl font-extrabold">
                {order.amountUsd}{" "}
                <span className="text-sm font-bold text-muted-foreground">for coins</span>
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Send to{" "}
                <a
                  href={venmoProfileUrl(order.recipient)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold text-[#3d95ce] hover:underline"
                >
                  @{order.recipient}
                </a>{" "}
                on Venmo
              </p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Close"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {done ? (
            <div className="mt-6 rounded-2xl border border-green-500/40 bg-green-500/10 p-5 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-500/20">
                <Check className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <p className="mt-3 font-extrabold">We&apos;re checking your payment</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Order <code className="font-mono font-bold">{order.referenceCode}</code> is in the
                queue. Your coins land as soon as the payment is matched — usually within a few
                hours.
              </p>
              <Button className="mt-4 w-full" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          ) : (
            <>
              <div className="mt-4 space-y-2">
                <CopyRow label="Send exactly" value={`$${order.amountUsd}`} />
                <CopyRow
                  label="Order code (put this in the Venmo note)"
                  value={order.referenceCode}
                />
                <CopyRow label="Venmo note" value={order.note} />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button asChild className="gap-1.5 bg-[#3d95ce] text-white hover:bg-[#3380b3]">
                  <a href={order.venmoUrl} target="_blank" rel="noreferrer">
                    Open Venmo <ArrowUpRight className="h-4 w-4" />
                  </a>
                </Button>
                <Button asChild variant="secondary" className="gap-1.5">
                  <a href={order.appUrl}>
                    <Smartphone className="h-4 w-4" /> Open app
                  </a>
                </Button>
              </div>

              <ol className="mt-4 space-y-1.5 text-sm text-muted-foreground">
                <li className="flex gap-2">
                  <span className="font-bold text-foreground">1.</span> Open Venmo and send{" "}
                  <span className="font-semibold text-foreground">${order.amountUsd}</span> to{" "}
                  <span className="font-semibold text-foreground">@{order.recipient}</span>.
                </li>
                <li className="flex gap-2">
                  <span className="font-bold text-foreground">2.</span> Put{" "}
                  <span className="font-mono font-semibold text-foreground">
                    {order.referenceCode}
                  </span>{" "}
                  in the note — without it we can&apos;t match your payment.
                </li>
                <li className="flex gap-2">
                  <span className="font-bold text-foreground">3.</span> Come back here and tell us
                  the username you paid from.
                </li>
              </ol>

              <div className="mt-5 rounded-2xl border border-border bg-card p-4">
                <p className="text-sm font-extrabold">Already sent it?</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  We only need the account you paid from so we can find the payment.
                </p>

                <label
                  htmlFor="venmo-payer-handle"
                  className="mt-3 block text-xs font-bold uppercase tracking-wide text-muted-foreground"
                >
                  Your Venmo username
                </label>
                <div className="mt-1 flex items-center rounded-lg border border-border bg-background focus-within:border-primary">
                  <span className="pl-3 text-sm font-bold text-muted-foreground">@</span>
                  <input
                    id="venmo-payer-handle"
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    placeholder="your-venmo"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    className="w-full bg-transparent px-2 py-2 text-sm outline-none"
                  />
                </div>
                {handleError && (
                  <p className="mt-1 text-xs text-destructive">
                    That doesn&apos;t look like a Venmo username.
                  </p>
                )}

                <label
                  htmlFor="venmo-note"
                  className="mt-3 block text-xs font-bold uppercase tracking-wide text-muted-foreground"
                >
                  Transaction id or note (optional)
                </label>
                <input
                  id="venmo-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. 3928… or “sent from my phone”"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />

                <Button
                  className="mt-3 w-full gap-2"
                  disabled={busy || !handle.trim() || handleError}
                  onClick={() => void submit()}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  I&apos;ve sent the payment
                </Button>
              </div>

              <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                Coins are added by hand after the payment is matched, so it isn&apos;t instant. If
                nothing arrives within 24 hours, message an admin with your order code.
              </p>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
