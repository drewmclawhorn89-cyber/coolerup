import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { WarningModal } from "@/components/WarningModal";
import { myStrikeStatus, onStrike, type StrikeResult } from "@/lib/autoBans";

/**
 * Owns the 3-strike warning popup and the current mute state.
 *
 * Mounted once near the root. Anything that writes user content calls
 * `screenContent()` from `@/lib/autoBans`; that broadcasts a strike, this
 * provider catches it and renders the popup. Components that gate posting can
 * read `muted` from `useWarnings()`.
 */
type WarningContextValue = {
  /** True while the 24-hour mute from strike 2 is in effect. */
  muted: boolean;
  mutedUntil: string | null;
  /** Current strike count, so a blocked post can re-show the right 1/2/3 popup. */
  strikeCount: number;
  /** Re-read `my_strike_status()` (call after a strike or on focus). */
  refresh: () => Promise<void>;
  /** Raise the popup manually, e.g. when a muted user tries to post. */
  notify: (result: StrikeResult) => void;
};

const WarningContext = createContext<WarningContextValue>({
  muted: false,
  mutedUntil: null,
  strikeCount: 0,
  refresh: async () => {},
  notify: () => {},
});

export function WarningProvider({ children }: { children: React.ReactNode }) {
  const [result, setResult] = useState<StrikeResult | null>(null);
  const [mutedUntil, setMutedUntil] = useState<string | null>(null);
  const [strikeCount, setStrikeCount] = useState(0);

  const refresh = useCallback(async () => {
    const status = await myStrikeStatus();
    const until = status.muted ? status.muted_until : null;
    setMutedUntil(until && new Date(until).getTime() > Date.now() ? until : null);
    setStrikeCount(status.strike_count ?? 0);
  }, []);

  // Any strike raised anywhere in the app lands here.
  useEffect(() => {
    const off = onStrike((r) => {
      setResult(r);
      void refresh();
    });
    return off;
  }, [refresh]);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const value = useMemo<WarningContextValue>(
    () => ({
      muted: Boolean(mutedUntil),
      mutedUntil,
      strikeCount,
      refresh,
      notify: (r: StrikeResult) => {
        setResult(r);
        void refresh();
      },
    }),
    [mutedUntil, strikeCount, refresh],
  );

  return (
    <WarningContext.Provider value={value}>
      {children}
      <WarningModal result={result as StrikeResult} onClose={() => setResult(null)} />
    </WarningContext.Provider>
  );
}

export function useWarnings(): WarningContextValue {
  return useContext(WarningContext);
}
