import { ExternalLink, Lock } from "lucide-react";
import { toast } from "sonner";
import {
  SHOP_ITEMS,
  SHOP_PERKS,
  claimPerk,
  equip,
  useClaimedPerks,
  useEquipped,
  type ShopItem,
  type ShopPerk,
} from "@/lib/shop";

export function ShopPanel({ handle, posts }: { handle: string | null; posts: number }) {
  const eq = useEquipped(handle);
  const claimed = useClaimedPerks(handle);

  const claim = (perk: ShopPerk) => {
    if (!handle) {
      toast.error("Sign in to claim the free trial");
      return;
    }
    if (!claimed.includes(perk.id)) {
      claimPerk(handle, perk.id);
      toast.success(`${perk.label} free trial claimed \u2014 finish signup to activate it`);
    }
    window.open(perk.url, "_blank", "noopener,noreferrer");
  };

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

  return (
    <div className="space-y-8 p-4 pb-24 md:p-10">
      <div>
        <h2 className="font-display text-2xl md:text-3xl">Shop</h2>
        <p className="text-sm text-muted-foreground">
          You've posted {posts}. Unlock tops, name styles and animals by posting, then equip them on
          your profile. Free trials are on us.
        </p>
      </div>

      <section>
        <h3 className="mb-2 font-display text-lg">Free trials</h3>
        <div className="grid gap-3">
          {SHOP_PERKS.map((perk) => {
            const on = claimed.includes(perk.id);
            return (
              <div
                key={perk.id}
                className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${perk.face} p-4 text-white shadow-lg`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="inline-flex items-center gap-1 rounded-full bg-black/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest">
                      Free trial
                    </span>
                    <p className="mt-2 flex items-center gap-2 font-display text-2xl font-bold">
                      <span aria-hidden>{perk.emoji}</span> {perk.label}
                    </p>
                    <p className="text-sm text-white/90">{perk.blurb}</p>
                    <p className="mt-1 text-xs text-white/70">
                      {perk.days} days free · card required at signup
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => claim(perk)}
                    className="shrink-0 rounded-full bg-white px-4 py-2 text-sm font-bold text-black shadow transition hover:bg-white/90"
                  >
                    <span className="flex items-center gap-1">
                      {on ? "Open" : "Claim"}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </span>
                  </button>
                </div>
                {on && (
                  <p className="mt-2 text-xs font-semibold text-white/90">
                    Claimed · finish signup on {perk.label} to start your trial
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Trials are offered by the streaming service and need a payment method with them. Claiming
          here saves your spot and opens their signup page.
        </p>
      </section>

      {section("top", "Tops")}
      {section("name", "Name shop")}
      {section("animal", "Animals (unlock one every 10 videos)")}
    </div>
  );
}
