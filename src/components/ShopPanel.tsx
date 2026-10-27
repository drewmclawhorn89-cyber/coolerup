import { Lock } from "lucide-react";
import { toast } from "sonner";
import { SHOP_ITEMS, equip, useEquipped, type ShopItem } from "@/lib/shop";

export function ShopPanel({ handle, posts }: { handle: string | null; posts: number }) {
  const eq = useEquipped(handle);
  const toggle = (item: ShopItem) => {
    if (!handle) return toast.error("Sign in to use the shop");
    if (posts < item.need) return toast.error(`Post ${item.need - posts} more to unlock ${item.label}`);
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
            <button key={item.id} onClick={() => toggle(item)} className={`flex flex-col items-center gap-1 rounded-2xl border p-4 text-center ${on ? "border-primary bg-primary/10" : "bg-card"} ${locked ? "opacity-60" : ""}`}>
              <span className="text-4xl">{item.emoji}</span>
              <span className={`font-bold ${kind === "name" ? item.className : ""}`}>{item.label}</span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                {locked ? <><Lock className="h-3 w-3" /> Post {item.need} video{item.need === 1 ? "" : "s"}</> : on ? "Equipped" : "Unlocked · tap to equip"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
  return (
    <div className="space-y-6 p-4 pb-24 md:p-10">
      <div>
        <h2 className="font-display text-2xl md:text-3xl">Shop</h2>
        <p className="text-sm text-muted-foreground">You've posted {posts}. Unlock tops, name styles and animals by posting, then equip them on your profile.</p>
      </div>
      {section("top", "Tops")}
      {section("name", "Name shop")}
      {section("animal", "Animals (unlock one every 10 videos)")}
    </div>
  );
}
