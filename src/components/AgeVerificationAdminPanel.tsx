import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ID_TYPES, signedAgeDocUrl } from "@/lib/ageVerification";

/** One row from `admin_age_verifications`. */
type PendingVerification = {
  user_id: string;
  username: string | null;
  display_name: string | null;
  profile_birthday: string | null;
  status: string;
  document_type: string | null;
  document_path: string | null;
  selfie_path: string | null;
  country: string | null;
  id_date_of_birth: string | null;
  submitted_at: string | null;
};

const FILTERS = [
  ["pending", "Pending"],
  ["approved", "Approved"],
  ["rejected", "Rejected"],
] as const;

const idTypeLabel = (value: string | null) =>
  ID_TYPES.find((t) => t.value === value)?.label ?? value ?? "ID";

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

/**
 * Admin queue for the 18+ real-ID check. Documents live in a private bucket, so
 * they are only ever opened through a short-lived signed URL.
 */
export function AgeVerificationAdminPanel() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("pending");
  const [rows, setRows] = useState<PendingVerification[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("admin_age_verifications", { _status: filter });
    if (error) {
      toast.error(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as PendingVerification[]);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDoc = async (path: string | null) => {
    if (!path) return;
    const url = await signedAgeDocUrl(path);
    if (!url) {
      toast.error("Could not open that document");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const review = async (row: PendingVerification, approve: boolean) => {
    let reason: string | null = null;
    if (!approve) {
      reason = window.prompt("Why was this ID rejected? (shown to the user)") ?? "";
      if (!reason.trim()) return;
    }
    setBusy(row.user_id);
    const { data, error } = await supabase.rpc("admin_review_age_verification", {
      _user_id: row.user_id,
      _approve: approve,
      ...(reason ? { _reason: reason.trim() } : {}),
    });
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    const result = data as { ok?: boolean; error?: string } | null;
    if (result && result.ok === false) {
      toast.error(result.error ?? "Could not save that review");
      return;
    }
    toast.success(approve ? "ID approved" : "ID rejected");
    void load();
  };

  return (
    <section className="space-y-3">
      <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        A typed-in birthday is self-reported, so 18+ videos stay locked until an ID is approved
        here. Documents are private: opening one creates a link that expires in five minutes.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-1 gap-1 rounded-lg bg-muted p-1">
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition ${
                filter === id ? "bg-background shadow-sm" : "text-muted-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      {loading && rows.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading ID checks…</p>
      )}
      {!loading && rows.length === 0 && (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          No {filter} ID checks.
        </p>
      )}

      {rows.map((row) => (
        <article key={row.user_id} className="rounded-xl border border-border bg-card p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {row.display_name || row.username || row.user_id.slice(0, 8)}
                {row.username ? (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    @{row.username}
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {idTypeLabel(row.document_type)} · ID DOB {row.id_date_of_birth ?? "—"} · profile
                DOB {row.profile_birthday ?? "—"}
                {row.country ? ` · ${row.country}` : ""}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Submitted {when(row.submitted_at)}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                row.status === "approved"
                  ? "bg-emerald-500/15 text-emerald-500"
                  : row.status === "rejected"
                    ? "bg-destructive/15 text-destructive"
                    : "bg-amber-500/15 text-amber-500"
              }`}
            >
              {row.status}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={!row.document_path}
              onClick={() => void openDoc(row.document_path)}
            >
              <ExternalLink className="h-3.5 w-3.5" /> View ID
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={!row.selfie_path}
              onClick={() => void openDoc(row.selfie_path)}
            >
              <ExternalLink className="h-3.5 w-3.5" /> View selfie
            </Button>
          </div>

          {row.status === "pending" && (
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                disabled={busy !== null}
                className="gap-1.5"
                onClick={() => void review(row, true)}
              >
                {busy === row.user_id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                Approve
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy !== null}
                className="gap-1.5"
                onClick={() => void review(row, false)}
              >
                <X className="h-3.5 w-3.5" /> Reject
              </Button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
