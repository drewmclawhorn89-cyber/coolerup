import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Calendar, Globe, Music2, Play, Sparkles, User } from "lucide-react";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About Coolerup — Made by Drew McLawhorn (@drewmclawhorn3)" },
      {
        name: "description",
        content:
          "Coolerup by Drew McLawhorn (@drewmclawhorn3). Released Oct 1, 2026. Last update Nov 15, 2026 — Christmas Update featuring Full Songs in Music tab, Coolerup Browser, and Background Play.",
      },
      { name: "author", content: "Drew McLawhorn" },
      { property: "og:title", content: "About Coolerup — by Drew McLawhorn" },
      {
        property: "og:description",
        content:
          "Made by Drew McLawhorn (@drewmclawhorn3). Last Update: Nov 15, 2026 — Christmas Update — Music + Browser.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://coolerup.lovable.app/about" },
      { property: "og:image", content: "https://coolerup.lovable.app/og-cover.png" },
      { property: "og:image", content: "https://coolerup.lovable.app/screenshot-foryou.png" },
      { property: "og:image", content: "https://coolerup.lovable.app/screenshot-music.png" },
      { property: "og:image", content: "https://coolerup.lovable.app/screenshot-browser.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "About Coolerup — by Drew McLawhorn" },
      {
        name: "twitter:description",
        content:
          "Shorts + Full Songs + Coolerup Browser — by Drew McLawhorn — Last update Nov 15 2026",
      },
      { name: "twitter:image", content: "https://coolerup.lovable.app/og-cover.png" },
    ],
    links: [{ rel: "canonical", href: "https://coolerup.lovable.app/about" }],
  }),
  component: AboutPage,
});

const SCREENSHOTS = [
  {
    src: "/screenshot-foryou.png",
    alt: "Coolerup For You short-video feed screenshot",
    title: "For You",
    caption: "Vertical short videos — less perfect, more real.",
  },
  {
    src: "/screenshot-music.png",
    alt: "Coolerup Music tab playing mgk - starman full song",
    title: "Music Tab",
    caption: "Full Songs in Music tap — featuring mgk - starman and Background Play.",
  },
  {
    src: "/screenshot-browser.png",
    alt: "Coolerup Browser powered by Chromium screenshot",
    title: "Coolerup Browser",
    caption: "Built-in Coolerup Browser powered by Chromium with quick search & bookmarks.",
  },
] as const;

function AboutPage() {
  return (
    <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background">
      <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-6">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            aria-label="Back to For You"
            className="text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight">
              coolerup<span className="text-primary">.</span>
            </h1>
            <p className="text-xs text-muted-foreground">A little more you</p>
          </div>
        </div>

        <section className="mt-5 rounded-2xl border bg-card p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-foreground">
            <User className="h-4 w-4 text-primary" />
            <span>Made by Drew McLawhorn (@drewmclawhorn3)</span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border bg-background/60 p-3.5">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Calendar className="h-3.5 w-3.5 text-primary" />
                Released
              </div>
              <p className="mt-1 text-sm font-semibold text-foreground">Released: Oct 1, 2026</p>
            </div>

            <div className="rounded-xl border bg-background/60 p-3.5">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Latest Release
              </div>
              <p className="mt-1 text-sm font-semibold text-foreground">
                Last Update: Nov 15, 2026 — Christmas Update — Music + Browser
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-primary/30 bg-primary/10 p-4">
            <h2 className="font-display text-base font-bold text-foreground">What&apos;s New</h2>
            <p className="mt-1 text-sm leading-relaxed text-foreground/90">
              What&apos;s New: Full Songs in Music tap, Coolerup Browser powered by Chromium,
              Background Play
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground transition hover:bg-primary/90"
            >
              <Play className="h-3.5 w-3.5" />
              Watch Shorts
            </Link>
            <Link
              to="/music"
              className="inline-flex items-center gap-1.5 rounded-xl border bg-background px-4 py-2 text-xs font-bold text-foreground transition hover:bg-secondary"
            >
              <Music2 className="h-3.5 w-3.5 text-primary" />
              Open Music
            </Link>
            <Link
              to="/browser"
              className="inline-flex items-center gap-1.5 rounded-xl border bg-background px-4 py-2 text-xs font-bold text-foreground transition hover:bg-secondary"
            >
              <Globe className="h-3.5 w-3.5 text-primary" />
              Coolerup Browser
            </Link>
          </div>
        </section>

        <section className="mt-6">
          <h2 className="font-display text-lg font-bold text-foreground">App Screenshots</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Inside Coolerup 2.0 — For You Shorts, Music Full Songs, and Coolerup Browser.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {SCREENSHOTS.map((shot) => (
              <figure
                key={shot.src}
                className="overflow-hidden rounded-2xl border bg-card transition hover:border-primary/40"
              >
                <img
                  src={shot.src}
                  alt={shot.alt}
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  className="aspect-[9/16] w-full bg-black object-cover"
                />
                <figcaption className="p-3.5">
                  <div className="text-sm font-bold text-foreground">{shot.title}</div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {shot.caption}
                  </p>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-xs text-muted-foreground">
          <span>Coolerup by Drew McLawhorn (@drewmclawhorn3)</span>
          <div className="flex items-center gap-4">
            <Link
              to="/privacy"
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              Privacy Policy
            </Link>
            <Link to="/" className="underline-offset-4 hover:text-foreground hover:underline">
              Home
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
