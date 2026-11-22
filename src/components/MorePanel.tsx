import { useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Compass,
  ExternalLink,
  Gift,
  Globe,
  Link2,
  Radio,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Store,
  Users,
} from "lucide-react";
import {
  SOCIAL_APPS,
  buildSocialEmbed,
  type EmbedResult,
  type SocialApp,
  type SocialAppId,
} from "@/lib/socialEmbeds";

/** Brand tiles are flat colour, so pick a readable monogram colour per brand. */
function monogramClass(color: string): string {
  const hex = color.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16) || 0;
  const g = parseInt(hex.slice(2, 4), 16) || 0;
  const b = parseInt(hex.slice(4, 6), 16) || 0;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "text-black" : "text-white";
}

function AppBadge({ app, className = "" }: { app: SocialApp; className?: string }) {
  return (
    <span
      aria-hidden
      className={`flex items-center justify-center rounded-2xl font-display font-black ${monogramClass(
        app.color,
      )} ${className}`}
      style={{ backgroundColor: app.color }}
    >
      {app.name.slice(0, 1)}
    </span>
  );
}

function openInApp(app: SocialApp) {
  window.open(app.webUrl, "_blank", "noopener,noreferrer");
}

/**
 * The "More" page: every social app Coolerup supports, in one grid. Tapping an
 * app opens its official embed player inside Coolerup — nothing is downloaded,
 * re-uploaded or handed off to a browser.
 *
 * The optional handlers keep the destinations that used to sit in the top tab
 * row (Browser, Marketplace, Groups, LIVE, Codes, Explore, Shop, Settings)
 * reachable from the same page.
 */
type MorePanelProps = {
  codesSeason?: boolean;
  onOpenBrowser?: () => void;
  onSelectMarketplace?: () => void;
  onSelectGroups?: () => void;
  onSelectLive?: () => void;
  onSelectCodes?: () => void;
  onSelectExplore?: () => void;
  onSelectShop?: () => void;
  onOpenSettings?: () => void;
};

export function MorePanel({
  codesSeason = false,
  onOpenBrowser,
  onSelectMarketplace,
  onSelectGroups,
  onSelectLive,
  onSelectCodes,
  onSelectExplore,
  onSelectShop,
  onOpenSettings,
}: MorePanelProps = {}) {
  const [openId, setOpenId] = useState<SocialAppId | null>(null);
  const app = openId ? SOCIAL_APPS.find((a) => a.id === openId) : null;

  if (app) return <SocialPlayer app={app} onBack={() => setOpenId(null)} />;

  const extras = [
    { key: "browser", label: "Coolerup Browser", icon: Globe, onClick: onOpenBrowser },
    { key: "marketplace", label: "Marketplace", icon: Store, onClick: onSelectMarketplace },
    { key: "groups", label: "Groups", icon: Users, onClick: onSelectGroups },
    { key: "live", label: "LIVE", icon: Radio, onClick: onSelectLive },
    ...(codesSeason ? [{ key: "codes", label: "Codes", icon: Gift, onClick: onSelectCodes }] : []),
    { key: "explore", label: "Explore", icon: Compass, onClick: onSelectExplore },
    { key: "shop", label: "Shop", icon: ShoppingBag, onClick: onSelectShop },
    { key: "settings", label: "Settings", icon: Settings, onClick: onOpenSettings },
  ].filter(
    (item): item is typeof item & { onClick: () => void } => typeof item.onClick === "function",
  );

  return (
    <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto bg-black px-4 pb-28 pt-5 text-white">
      <div className="mx-auto w-full max-w-3xl">
        <h2 className="font-display text-2xl font-bold">More</h2>
        <p className="mt-1 text-sm text-white/60">
          Every app you love, playing inside Coolerup with its official embed.
        </p>

        <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {SOCIAL_APPS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setOpenId(item.id)}
              aria-label={`Open ${item.name}`}
              className="flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-2 py-4 text-center transition hover:border-white/25 hover:bg-white/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FE2C55]"
            >
              <AppBadge app={item} className="h-12 w-12 text-xl" />
              <span className="text-[13px] font-bold leading-tight">{item.name}</span>
              <span className="text-[10px] leading-tight text-white/50">{item.tagline}</span>
            </button>
          ))}
        </div>

        <p className="mt-6 flex items-start gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-[11px] leading-relaxed text-white/50">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#FE2C55]" />
          Embeds are served by each app's own player. Coolerup never downloads or re-uploads
          anyone's videos.
        </p>

        {extras.length > 0 && (
          <section aria-labelledby="more-in-coolerup" className="mt-8">
            <h3 id="more-in-coolerup" className="text-sm font-bold text-white">
              More in Coolerup
            </h3>
            <p className="mt-1 text-[11px] text-white/50">The rest of the app, one tap away</p>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {extras.map(({ key, label, icon: Icon, onClick }) => (
                <button
                  key={key}
                  type="button"
                  onClick={onClick}
                  className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-left transition hover:border-[#FE2C55] hover:bg-white/[0.09]"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FE2C55] text-white">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-white">
                    {label}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function SocialPlayer({ app, onBack }: { app: SocialApp; onBack: () => void }) {
  const [input, setInput] = useState(app.defaultInput ?? "");
  const [applied, setApplied] = useState(app.defaultInput ?? "");

  const result: EmbedResult = useMemo(() => buildSocialEmbed(app, applied), [app, applied]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setApplied(input);
  };

  return (
    <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto bg-black text-white">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-white/10 bg-black/95 px-3 py-2.5 backdrop-blur">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to More"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
        >
          <ArrowLeft className="size-4" />
        </button>
        <AppBadge app={app} className="h-8 w-8 text-sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{app.name}</p>
          <p className="truncate text-[11px] text-white/50">Official embed player</p>
        </div>
        {!app.embeddable && (
          <button
            type="button"
            onClick={() => openInApp(app)}
            className="shrink-0 rounded-full bg-[#FE2C55] px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-[#e0254b]"
          >
            Open in App
          </button>
        )}
      </div>

      {app.embeddable && (
        <form
          onSubmit={submit}
          className="mx-auto flex w-full max-w-2xl items-center gap-2 px-3 pt-3"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-3 py-2">
            <Link2 className="size-4 shrink-0 text-white/40" />
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={app.placeholder}
              aria-label={`${app.name} link`}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-white placeholder:text-white/35 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="shrink-0 rounded-full bg-[#FE2C55] px-4 py-2 text-[12px] font-bold text-white transition hover:bg-[#e0254b]"
          >
            Embed
          </button>
        </form>
      )}

      <div className="flex min-h-0 flex-1 flex-col items-center px-3 pb-8 pt-3">
        {result.kind === "embed" ? (
          <>
            <div
              className={`w-full overflow-hidden rounded-2xl border border-white/10 bg-black ${
                result.ratio === "video"
                  ? "aspect-video max-w-3xl"
                  : result.ratio === "portrait"
                    ? "h-[min(72vh,720px)] max-w-[420px]"
                    : "h-[min(72vh,720px)] max-w-[540px]"
              }`}
            >
              <iframe
                key={result.url}
                src={result.url}
                title={`${app.name} embed`}
                className="h-full w-full border-0"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
            <button
              type="button"
              onClick={() => openInApp(app)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-white/15 px-4 py-2 text-[12px] font-bold text-white/80 transition hover:border-white/35 hover:text-white"
            >
              <ExternalLink className="size-3.5" />
              Open in App
            </button>
          </>
        ) : result.kind === "needs-link" ? (
          <div className="mt-10 w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center">
            <AppBadge app={app} className="mx-auto h-14 w-14 text-2xl" />
            <p className="mt-4 text-sm font-bold">{app.name} embed</p>
            <p className="mt-1 text-[12px] leading-relaxed text-white/60">{result.hint}</p>
          </div>
        ) : (
          <div className="mt-10 w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center">
            <AppBadge app={app} className="mx-auto h-14 w-14 text-2xl" />
            <p className="mt-4 text-sm font-bold">{app.name} doesn't allow embedding</p>
            <p className="mt-1 text-[12px] leading-relaxed text-white/60">
              {app.name} has no official embed player, so open it in the app to keep watching.
            </p>
            <button
              type="button"
              onClick={() => openInApp(app)}
              className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-[#FE2C55] px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-[#e0254b]"
            >
              <ExternalLink className="size-4" />
              Open in App
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
