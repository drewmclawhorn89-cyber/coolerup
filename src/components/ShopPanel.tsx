import { useCallback, useEffect, useMemo, useState } from "react";
import { Gift, Lock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { SHOP_ITEMS, equip, useEquipped, type ShopItem } from "@/lib/shop";
import {
  GIFT_CARDS,
  GIFT_CARD_TAGS,
  formatUsd,
  giftCardById,
  maskCode,
  type GiftCardBrand,
  type GiftCardOrder,
  type GiftCardTag,
} from "@/lib/giftcards";
import { GiftCardSheet } from "@/components/GiftCardSheet";
import { supabase } from "@/integrations/supabase/client";

export function ShopPanel({ handle, posts }: { handle: string | null; posts: number }) {
  const eq = useEquipped(handle);
  const [buying, setBuying] = useState<GiftCardBrand | null>(null);
  const [tag, setTag] = useState<GiftCardTag>("all");
  const [orders, setOrders] = useState<GiftCardOrder[]>([]);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const loadOrders = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setOrders([]);
      return;
    }
    const { data } = await supabase
      .from("gift_card_orders")
      .select(
        "id, card_id, card_name, amount_cents, recipient_email, status, code, redemption_url, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(25);
    setOrders((data ?? []) as GiftCardOrder[]);
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const toggle = (item: ShopItem) => {
    if (!handle) {
      toast.error("Sign in to use the shop");
      return;
    }
    if (posts < item.need) {
      toast.error(`Post ${item.need - posts} more to unlock ${item.label}`);
      return;
    }
    const on = eq[item.kind] === item.id;
    equip(handle, on ? null : item, item.kind);
    toast.success(on ? `${item.label} removed` : `${item.label} equipped`);
  };

  const section = (kind: ShopItem["kind"], title: string) => (
    <section>
      <h3 className="mb-2 font-display text-lg">{title}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {SHOP_ITEMS.filter((i) => i.kind === kind).map((item) => {
          const locked = posts < item.need;
          const on = eq[kind] === item.id;
          return (
            <button
              key={item.id}
              onClick={() => toggle(item)}
              className={`flex flex-col items-center gap-1 rounded-2xl border p-4 text-center ${
                on ? "border-primary bg-primary/10" : "bg-card"
              } ${locked ? "opacity-60" : ""}`}
            >
              <span className="text-4xl">{item.emoji}</span>
              <span className={`font-bold ${kind === "name" ? item.className : ""}`}>
                {item.label}
              </span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {locked ? (
                  <>
                    <Lock className="h-3 w-3" /> Post {item.need} video{item.need === 1 ? "" : "s"}
                  </>
                ) : on ? (
                  "Equipped"
                ) : (
                  "Unlocked \u00b7 tap to equip"
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );

  const shownCards = useMemo(
    () => (tag === "all" ? GIFT_CARDS : GIFT_CARDS.filter((c) => c.tags.includes(tag))),
    [tag],
  );

  const openGift = (card: GiftCardBrand) => {
    if (!handle) {
      toast.error("Sign in to buy gift cards");
      return;
    }
    setBuying(card);
  };

  return (
    <div className="space-y-8 p-4 pb-24 md:p-10">
      <div>
        <h2 className="font-display text-2xl md:text-3xl">Shop</h2>
        <p className="text-sm text-muted-foreground">
          You've posted {posts}. Unlock tops, name styles and animals by posting, then equip them on
          your profile — or grab a real gift card and send it to anyone.
        </p>
      </div>

      {/* Real gift cards */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 font-display text-lg">
              <Gift className="h-5 w-5 text-primary" /> Gift cards
            </h3>
            <p className="text-xs text-muted-foreground">
              Real, redeemable codes from the brands below — emailed instantly after checkout.
            </p>
          </div>
          <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary">
            <Sparkles className="h-3 w-3" /> No fees
          </span>
        </div>

        <div className="mb-3 flex gap-2 overflow-x-auto no-scrollbar">
          {GIFT_CARD_TAGS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTag(t.id)}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${
                tag === t.id
                  ? "border-primary bg-primary text-white"
                  : "bg-card text-muted-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {shownCards.map((card) => (
            <button
              key={card.id}
              onClick={() => openGift(card)}
              className="group overflow-hidden rounded-2xl border bg-card text-left transition-transform hover:-translate-y-0.5"
            >
              <div className={`relative flex h-24 items-end bg-gradient-to-br ${card.face} p-3`}>
                <span className="absolute right-2 top-2 text-2xl drop-shadow">{card.emoji}</span>
                <span className="font-display text-base font-bold text-white drop-shadow">
                  {card.name}
                </span>
              </div>
              <div className="p-3">
                <p className="line-clamp-2 text-xs text-muted-foreground">{card.blurb}</p>
                <p className="mt-1 text-sm font-bold">
                  ${card.amounts[0]} – ${card.amounts[card.amounts.length - 1]}
                </p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Order history */}
      {orders.length > 0 ? (
        <section>
          <h3 className="mb-2 font-display text-lg">My gift cards</h3>
          <div className="space-y-2">
            {orders.map((order) => {
              const card = giftCardById(order.card_id);
              const showCode = revealed.has(order.id);
              return (
                <div
                  key={order.id}
                  className="flex items-center gap-3 rounded-xl border bg-card p-3"
                >
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${
                      card?.face ?? "from-neutral-700 to-black"
                    } text-lg`}
                  >
                    {card?.emoji ?? "🎁"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {order.card_name} · {formatUsd(order.amount_cents)}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {order.status === "delivered"
                        ? showCode && order.code
                          ? order.code
                          : order.code
                            ? maskCode(order.code)
                            : "Delivered"
                        : order.status === "failed"
                          ? "Payment failed"
                          : "Pending — code on the way"}
                    </p>
                  </div>
                  {order.code ? (
                    <button
                      onClick={() =>
                        setRevealed((prev) => {
                          const next = new Set(prev);
                          if (next.has(order.id)) next.delete(order.id);
                          else next.add(order.id);
                          return next;
                        })
                      }
                      className="shrink-0 rounded-full border px-3 py-1 text-xs font-semibold"
                    >
                      {showCode ? "Hide" : "Reveal"}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {section("top", "Tops")}
      {section("name", "Name shop")}
      {section("animal", "Animals (unlock one every 10 videos)")}

      <GiftCardSheet
        card={buying}
        handle={handle}
        onClose={() => setBuying(null)}
        onPurchased={() => void loadOrders()}
      />
    </div>
  );
}
