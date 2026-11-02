import { QueryClient, QueryClientProvider } from "@tanstack/react-query"; import { MessageCircle } from "lucide-react"
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { CallProvider } from "../lib/calls";
import { CallOverlay } from "../components/CallOverlay";
import { PhoneAuthDialog } from "../components/PhoneAuthDialog";
import { OnboardingRequiredDialog } from "../components/OnboardingBanner";
import { Toaster } from "sonner";
import { WellbeingWatcher } from "../components/MoreSettings";
import { PushRegistrar } from "../components/PushRegistrar";
import { BanGate } from "../components/BanGate";
import { UpdateGate } from "../components/UpdateGate";
import { applyPrefs } from "../lib/prefs";
import { AuthProvider, useAuth } from "../hooks/useAuth";
import { SnowEffect } from "../components/SnowEffect";
function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => {
    const supabaseUrl = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
    const supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : undefined;
    return {
      meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "coolerup" },
      { name: "description", content: "Short videos, less perfect, more real." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#000000" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black" },
      { name: "apple-mobile-web-app-title", content: "coolerup" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/manifest.json" },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/icons/icon-192.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      ...(supabaseOrigin
        ? [
            { rel: "preconnect" as const, href: supabaseOrigin, crossOrigin: "anonymous" as const },
            { rel: "dns-prefetch" as const, href: supabaseOrigin },
          ]
        : []),
      { rel: "preconnect", href: "https://api.audius.co" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Archivo+Black&family=Manrope:wght@400;500;600;700;800&display=swap",
      },
    ],
    };
  },
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

/**
 * After a fresh Google/Apple/email signup the account is seconds old, so send
 * it to /onboarding instead of For You. Old accounts are never redirected —
 * they keep browsing and just see the yellow banner.
 */
function OnboardingGate() {
  const auth = useAuth();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (!auth.ready || !auth.user || !auth.onboarding.ready) return;
    if (!auth.onboarding.needsOnboarding || !auth.onboarding.isNewUser) return;
    if (pathname === "/onboarding") return;
    // Redirect at most once per account per session. Without this, the moment
    // right after "Finish" (before the refreshed profile lands) could bounce
    // the user back to /onboarding.
    try {
      const key = `loop-onboarding-redirected:${auth.user.id}`;
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      /* private mode — still redirect */
    }
    void router.navigate({ to: "/onboarding" });
  }, [
    auth.ready,
    auth.user,
    auth.onboarding.ready,
    auth.onboarding.needsOnboarding,
    auth.onboarding.isNewUser,
    pathname,
    router,
  ]);

  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    applyPrefs();
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    mq?.addEventListener?.("change", applyPrefs);
    return () => mq?.removeEventListener?.("change", applyPrefs);
  }, []);

  // Cache the app shell and static assets so Coolerup still opens on weak or
  // missing connections. Skipped in dev to avoid stale-module confusion.
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CallProvider>
          <OnboardingGate />
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          {/* UpdateGate sits outermost: when a deploy is in progress, or a newer
              build has shipped, it unmounts the entire app — BanGate included. */}
          <UpdateGate>
            <BanGate>
              <Outlet />
            </BanGate>
          </UpdateGate>
          <CallOverlay />
          <WellbeingWatcher />
          <PushRegistrar />
        </CallProvider>
        <PhoneAuthDialog />
        <OnboardingRequiredDialog />
        <Toaster theme="dark" position="top-center" />
        {/* 50 falling white dots, Nov 15 2026 -> Jan 1 2027 only. */}
        <SnowEffect />
      </AuthProvider>
    </QueryClientProvider>
  );
}
