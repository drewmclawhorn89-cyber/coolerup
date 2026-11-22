import { useEffect, useState } from "react";
import { ArrowUpRight, Loader2, Music2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  coolerupFollowerCount,
  shareCoolerupToTikTok,
  shareTikTokToCoolerup,
  useTikTokAccount,
} from "@/lib/tiktokLink";
import { tiktokCreatorUrl } from "@/lib/tiktok";

const TIKTOK_RED = "#FE2C55";

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

/**
 * The linked-TikTok panel on your own profile.
 *
 * Shows the two follower counts side by side — TikTok's, read from the stored
 * account, and Coolerup's, counted from `follows` — plus the two share actions.
 * Renders nothing when no account is linked, so an unlinked profile looks
 * exactly as it did before.
 */
export function TikTokProfileCard({ username }: { username: string }) {
  const auth = useAuth();
  const { account, loading, checked } = useTikTokAccount(Boolean(auth.user));
  const [coolerupFollowers, setCoolerupFollowers] = useState<number | null>(null);
  const [sharing, setSharing] = useState<"to-tiktok" | "to-coolerup" | null>(null);

  useEffect(() => {
    let alive = true;
    void coolerupFollowerCount(username).then((n) => {
      if (alive) setCoolerupFollowers(n);
    });
    return () => {
      alive = false;
    };
  }, [username]);

  if (loading && !checked) return null;
  if (!account) return null;

  const handleShareToTikTok = async () => {
    setSharing("to-tiktok");
    try {
      const how = await shareCoolerupToTikTok(username);
      toast.success(
        how === "shared"
          ? "Shared to TikTok"
          : "Coolerup link copied — paste it into your TikTok post or bio.",
      );
    } catch {
      toast.error("Couldn't open the share sheet.");
    } finally {
      setSharing(null);
    }
  };

  const handleShareToCoolerup = async () => {
    const userId = auth.user?.id;
    const coolerupUsername = auth.profile?.username ?? auth.profile?.handle ?? username;
    if (!userId) {
      toast.error("Sign in to share to your Coolerup feed.");
      return;
    }
    setSharing("to-coolerup");
    try {
      await shareTikTokToCoolerup({
        username: account.username,
        coolerupUsername,
        userId,
        avatarUrl: account.avatarUrl,
      });
      toast.success("Posted your TikTok link to your Coolerup feed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't share to your feed.");
    } finally {
      setSharing(null);
    }
  };

  return (
    <div
      className="mt-4 rounded-xl p-4"
      style={{ backgroundColor: "black", color: "white" }}
      data-testid="tiktok-profile-card"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Music2 className="h-4 w-4 shrink-0" style={{ color: TIKTOK_RED }} />
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: "white" }}>
              TikTok linked
            </p>
            <a
              href={tiktokCreatorUrl(account.username)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 truncate text-xs underline"
              style={{ color: "#9ca3af" }}
            >
              @{account.username}
              <ArrowUpRight className="h-3 w-3" />
            </a>
          </div>
        </div>
        {account.avatarUrl && (
          <img
            src={account.avatarUrl}
            alt=""
            className="h-9 w-9 shrink-0 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <CountBox label="TikTok followers" value={formatCount(account.followerCount)} />
        <CountBox
          label="Coolerup followers"
          value={coolerupFollowers === null ? "–" : formatCount(coolerupFollowers)}
        />
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={handleShareToTikTok}
          disabled={sharing !== null}
          className="flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-60"
          style={{ backgroundColor: TIKTOK_RED, color: "white" }}
        >
          {sharing === "to-tiktok" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Share2 className="h-3 w-3" />
          )}
          Share Coolerup to TikTok
        </button>
        <button
          type="button"
          onClick={handleShareToCoolerup}
          disabled={sharing !== null}
          className="flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-60"
          style={{ backgroundColor: "#1a1a1a", color: "white", border: "1px solid #333" }}
        >
          {sharing === "to-coolerup" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Share2 className="h-3 w-3" />
          )}
          Share TikTok to Coolerup
        </button>
      </div>
    </div>
  );
}

function CountBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg p-3" style={{ backgroundColor: "#111" }}>
      <p className="text-lg font-bold tabular-nums" style={{ color: "white" }}>
        {value}
      </p>
      <p className="text-[11px]" style={{ color: "#9ca3af" }}>
        {label}
      </p>
    </div>
  );
}
