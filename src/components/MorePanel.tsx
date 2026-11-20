import { Compass, Gift, Globe, Radio, Settings, ShoppingBag, Store, Users } from "lucide-react";

type MorePanelProps = {
  codesSeason: boolean;
  onOpenBrowser: () => void;
  onSelectMarketplace: () => void;
  onSelectGroups: () => void;
  onSelectLive: () => void;
  onSelectCodes: () => void;
  onSelectExplore: () => void;
  onSelectShop: () => void;
  onOpenSettings: () => void;
};

export function MorePanel({
  codesSeason,
  onOpenBrowser,
  onSelectMarketplace,
  onSelectGroups,
  onSelectLive,
  onSelectCodes,
  onSelectExplore,
  onSelectShop,
  onOpenSettings,
}: MorePanelProps) {
  const items = [
    {
      key: "browser",
      label: "Coolerup Browser",
      desc: "Browse websites inside Coolerup",
      icon: Globe,
      onClick: onOpenBrowser,
    },
    {
      key: "marketplace",
      label: "Marketplace",
      desc: "Buy & sell items in Coolerup",
      icon: Store,
      onClick: onSelectMarketplace,
    },
    {
      key: "groups",
      label: "Groups",
      desc: "Join communities and group feeds",
      icon: Users,
      onClick: onSelectGroups,
    },
    {
      key: "live",
      label: "LIVE",
      desc: "Watch Coolerup creators live or go live",
      icon: Radio,
      onClick: onSelectLive,
    },
    ...(codesSeason
      ? [
          {
            key: "codes",
            label: "Codes",
            desc: "Redeem & share seasonal Christmas codes",
            icon: Gift,
            onClick: onSelectCodes,
          },
        ]
      : []),
    {
      key: "explore",
      label: "Explore",
      desc: "Discover trending videos",
      icon: Compass,
      onClick: onSelectExplore,
    },
    {
      key: "shop",
      label: "Shop",
      desc: "Coolerup Merch & coins",
      icon: ShoppingBag,
      onClick: onSelectShop,
    },
    {
      key: "settings",
      label: "Settings",
      desc: "Account, privacy & playback",
      icon: Settings,
      onClick: onOpenSettings,
    },
  ];

  return (
    <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto bg-black px-4 pb-28 pt-4 text-white">
      <h2 className="mb-1 text-lg font-extrabold text-white">More in Coolerup</h2>
      <p className="mb-4 text-xs text-white/60">Explore more features and tabs</p>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {items.map(({ key, label, desc, icon: Icon, onClick }) => (
          <button
            key={key}
            type="button"
            onClick={onClick}
            className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3.5 text-left transition hover:border-[#FE2C55] hover:bg-white/10"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FE2C55] text-white">
              <Icon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-white">{label}</span>
              <span className="block truncate text-xs text-white/60">{desc}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
