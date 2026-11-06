import { Gift, Lock } from "lucide-react";
import { toast } from "sonner";
import { SHOP_ITEMS, equip, useEquipped, type ShopItem } from "@/lib/shop";
import { FREE_GIFT_CARD_OFFERS, formatUsd, giftCardById } from "@/lib/giftcards";

export function ShopPanel({ handle, posts }: { handle: string | null; posts: number }) {
  const eq = useEquipped(handle);

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
                  "Unlocked · tap to equip"
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );

  return (
    <div className="space-y-8 p-4 pb-24 md:p-10">
      <div>
        <h2 className="font-display text-2xl md:text-3xl">Shop</h2>
        <p className="text-sm text-muted-foreground">
          You've posted {posts}. Unlock tops, name styles and animals by posting, then equip them on
          your profile.
        </p>
      </div>

      <section aria-labelledby="free-gift-cards-heading">
        <div className="mb-3">
          <h3 id="free-gift-cards-heading" className="flex items-center gap-2 font-display text-lg">
            <Gift className="h-5 w-5 text-primary" /> Free gift cards
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            These are the planned Coolerup-sponsored offers. Free claims are not active yet; gift
            card delivery needs to be enabled for this deployment.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FREE_GIFT_CARD_OFFERS.map((offer) => {
            const card = giftCardById(offer.cardId);
            if (!card) return null;
            return (
              <article
                key={card.id}
                className={`overflow-hidden rounded-2xl border bg-gradient-to-br ${card.face} p-4 text-white shadow-sm`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-white/75">
                      Coolerup giveaway · coming soon
                    </p>
                    <h4 className="mt-1 font-display text-xl">{card.name}</h4>
                    <p className="mt-1 text-sm text-white/80">{card.blurb}</p>
                  </div>
                  <span className="text-3xl" aria-hidden="true">{card.emoji}</span>
                </div>
                <div className="mt-5 flex items-center justify-between border-t border-white/20 pt-3">
                  <span className="font-semibold">{formatUsd(offer.amount * 100)} value</span>
                  <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold">FREE</span>
                </div>
                <p className="mt-2 text-xs text-white/75">Claim button will appear when sponsored fulfillment is enabled.</p>
              </article>
            );
          })}
        </div>
      </section>

      {section("top", "Tops")}
      {section("name", "Name shop")}
      {section("animal", "Animals (unlock one every 10 videos)")}
    </div>
  );
}
