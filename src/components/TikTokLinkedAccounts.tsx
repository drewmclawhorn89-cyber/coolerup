import { useEffect, useState } from "react";
import { Link2, Loader2, Unlink } from "lucide-react";
import { toast } from "sonner";
import {
  linkTikTokAccount,
  unlinkTikTokAccount,
  useTikTokAccount,
  type LinkedTikTok,
} from "@/lib/tiktokLink";
import { ImportFromTikTok } from "@/components/ImportFromTikTok";

const TIKTOK_RED = "#FE2C55";

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}

/**
 * Settings > Linked Accounts > TikTok.
 *
 * Black card, white text, matching the rest of Settings. Shows the handle once
 * connected so it is obvious which account is authorised, and offers Unlink.
 */
export function TikTokLinkedAccounts({ enabled = true }: { enabled?: boolean }) {
  const { account, loading, refresh } = useTikTokAccount(enabled);
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<LinkedTikTok | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    setLocal(account);
  }, [account]);

  const shown = local ?? account;

  const handleLink = async () => {
    setBusy(true);
    try {
      const linked = await linkTikTokAccount();
      setLocal(linked);
      await refresh();
      toast.success(`Connected as @${linked.username}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not link TikTok.");
    } finally {
      setBusy(false);
    }
  };

  const handleUnlink = async () => {
    setBusy(true);
    try {
      await unlinkTikTokAccount();
      setLocal(null);
      await refresh();
      toast.success("TikTok unlinked");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not unlink TikTok.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="rounded-xl p-4 shadow-sm"
      style={{ backgroundColor: "black", color: "white" }}
      data-testid="tiktok-linked-accounts"
    >
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4" style={{ color: TIKTOK_RED }} />
        <h2 className="font-semibold" style={{ color: "white" }}>
          Linked Accounts
        </h2>
      </div>
      <p className="mt-1 text-sm" style={{ color: "#9ca3af" }}>
        Connect your own TikTok account to cross-post and import your videos.
      </p>

      <div className="mt-4 rounded-lg p-3" style={{ backgroundColor: "#111", color: "white" }}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: "white" }}>
              TikTok
            </p>
            {loading && !shown ? (
              <p className="text-xs" style={{ color: "#9ca3af" }}>
                Checking…
              </p>
            ) : shown ? (
              <p className="truncate text-xs" style={{ color: "#9ca3af" }} data-testid="tiktok-connected-as">
                Connected as @{shown.username}
              </p>
            ) : (
              <p className="text-xs" style={{ color: "#9ca3af" }}>
                Not connected
              </p>
            )}
          </div>

          {shown ? (
            <div className="flex shrink-0 items-center gap-2">
              {shown.avatarUrl && (
                <img
                  src={shown.avatarUrl}
                  alt=""
                  className="h-8 w-8 rounded-full object-cover"
                  referrerPolicy="no-referrer"
                />
              )}
              <button
                type="button"
                onClick={handleUnlink}
                disabled={busy}
                className="flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                style={{ backgroundColor: "#333", color: "white" }}
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlink className="h-3 w-3" />}
                Unlink
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleLink}
              disabled={busy}
              className="flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-50"
              style={{ backgroundColor: TIKTOK_RED, color: "white" }}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
              Link TikTok Account
            </button>
          )}
        </div>

        {shown && (
          <div className="mt-3 flex flex-wrap gap-4 border-t pt-3" style={{ borderColor: "#222" }}>
            <Stat label="Followers" value={formatCount(shown.followerCount)} />
            <Stat label="Following" value={formatCount(shown.followingCount)} />
            <Stat label="Likes" value={formatCount(shown.likesCount)} />
            <Stat label="Videos" value={formatCount(shown.videoCount)} />
          </div>
        )}

        {shown && (
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="mt-3 w-full rounded-md px-3 py-2 text-xs font-semibold"
            style={{ backgroundColor: "black", color: "white", border: "1px solid #333" }}
          >
            Import from TikTok
          </button>
        )}
      </div>

      <p className="mt-3 text-[11px]" style={{ color: "#6b7280" }}>
        You sign in on TikTok's own screen. Coolerup never sees your TikTok password, and can only
        read or post to the account you connect here.
      </p>

      {importOpen && shown && (
        <ImportFromTikTok
          username={shown.username}
          open={importOpen}
          onOpenChange={setImportOpen}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm font-bold" style={{ color: "white" }}>
        {value}
      </p>
      <p className="text-[11px]" style={{ color: "#9ca3af" }}>
        {label}
      </p>
    </div>
  );
}
