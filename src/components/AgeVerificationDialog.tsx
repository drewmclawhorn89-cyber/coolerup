import { useEffect, useRef, useState } from "react";
import { BadgeCheck, Clock, IdCard, Loader2, ShieldCheck, Upload, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AGE_DOC_ACCEPT,
  AGE_VERIFY_PENDING_MESSAGE,
  AGE_VERIFY_REJECTED_MESSAGE,
  ID_TYPES,
  submitAgeVerification,
  useAgeVerification,
  type IdType,
} from "@/lib/ageVerification";

/** Red used for anything 18+. Matches the app's warning accent. */
const MATURE_RED = "#FE2C55";

const SHELL = {
  backgroundColor: "#000",
  borderColor: "rgba(255,255,255,0.16)",
  color: "#fff",
} as const;

const MUTED = { color: "rgba(255,255,255,0.6)" } as const;

function FilePicker({
  label,
  hint,
  file,
  onPick,
  inputRef,
}: {
  label: string;
  hint: string;
  file: File | null;
  onPick: (file: File | null) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className="rounded-xl border p-3" style={SHELL}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold" style={{ color: "#fff" }}>
            {label}
          </p>
          <p className="text-xs" style={MUTED}>
            {hint}
          </p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold"
          style={{ backgroundColor: "#fff", color: "#000" }}
        >
          {file ? "Change" : "Upload"}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={AGE_DOC_ACCEPT}
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      {preview && (
        <div className="relative mt-3 overflow-hidden rounded-lg border" style={SHELL}>
          <img src={preview} alt={label} className="max-h-40 w-full object-contain" />
          <button
            type="button"
            aria-label={`Remove ${label}`}
            onClick={() => {
              onPick(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/80 text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * "Verify my ID" — the only way to unlock 18+ videos.
 *
 * The account birthday is self-reported, so an adult video stays locked until a
 * moderator has looked at a government ID and a selfie. Both photos go into a
 * private bucket that only the owner and an admin can read; nothing here is
 * ever shown on a profile or in the feed.
 */
export function AgeVerificationDialog({
  open,
  onOpenChange,
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onSubmitted?: () => void;
}) {
  const { verification, status, loading, refresh } = useAgeVerification(open);
  const [documentType, setDocumentType] = useState<IdType>("drivers_license");
  const [idDob, setIdDob] = useState("");
  const [document, setDocument] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const docRef = useRef<HTMLInputElement | null>(null);
  const selfieRef = useRef<HTMLInputElement | null>(null);

  const canSubmit = Boolean(document && selfie) && !busy;

  const submit = async () => {
    if (!document || !selfie) {
      toast.error("Add both an ID photo and a selfie.");
      return;
    }
    setBusy(true);
    try {
      await submitAgeVerification({
        document,
        selfie,
        documentType,
        idDateOfBirth: idDob || null,
      });
      toast.success("ID submitted. A moderator will review it shortly.");
      setDocument(null);
      setSelfie(null);
      setIdDob("");
      if (docRef.current) docRef.current.value = "";
      if (selfieRef.current) selfieRef.current.value = "";
      await refresh();
      onSubmitted?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit your ID.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto border sm:max-w-md"
        style={{ backgroundColor: "#000", color: "#fff", borderColor: "rgba(255,255,255,0.16)" }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" style={{ color: "#fff" }}>
            <IdCard className="h-5 w-5" style={{ color: MATURE_RED }} />
            Verify your ID
          </DialogTitle>
          <DialogDescription style={MUTED}>
            18+ videos are locked until a moderator confirms you&apos;re an adult. This takes one
            government ID and one selfie.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm" style={MUTED}>
            <Loader2 className="h-4 w-4 animate-spin" /> Checking your status…
          </div>
        ) : (
          <div className="space-y-3">
            {status === "approved" && (
              <div
                className="flex items-start gap-2 rounded-xl border p-3"
                style={{ backgroundColor: "#000", borderColor: "rgba(34,197,94,0.5)" }}
              >
                <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#22c55e" }} />
                <div>
                  <p className="text-sm font-semibold" style={{ color: "#fff" }}>
                    ID verified
                  </p>
                  <p className="text-xs" style={MUTED}>
                    Your 18+ videos are unlocked.
                  </p>
                </div>
              </div>
            )}

            {status === "pending" && (
              <div
                className="flex items-start gap-2 rounded-xl border p-3"
                style={{ backgroundColor: "#000", borderColor: "rgba(255,193,7,0.5)" }}
              >
                <Clock className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#FFC107" }} />
                <div>
                  <p className="text-sm font-semibold" style={{ color: "#fff" }}>
                    In review
                  </p>
                  <p className="text-xs" style={MUTED}>
                    {AGE_VERIFY_PENDING_MESSAGE}
                  </p>
                </div>
              </div>
            )}

            {status === "rejected" && (
              <div
                className="flex items-start gap-2 rounded-xl border p-3"
                style={{ backgroundColor: "#000", borderColor: "rgba(254,44,85,0.5)" }}
              >
                <X className="mt-0.5 h-4 w-4 shrink-0" style={{ color: MATURE_RED }} />
                <div>
                  <p className="text-sm font-semibold" style={{ color: "#fff" }}>
                    Not approved
                  </p>
                  <p className="text-xs" style={MUTED}>
                    {verification.rejectionReason || AGE_VERIFY_REJECTED_MESSAGE}
                  </p>
                </div>
              </div>
            )}

            {status !== "approved" && (
              <>
                <div className="rounded-xl border p-3" style={SHELL}>
                  <label
                    htmlFor="age-id-type"
                    className="text-sm font-semibold"
                    style={{ color: "#fff" }}
                  >
                    Type of ID
                  </label>
                  <select
                    id="age-id-type"
                    value={documentType}
                    onChange={(e) => setDocumentType(e.target.value as IdType)}
                    className="mt-2 w-full rounded-lg border bg-black px-3 py-2 text-sm"
                    style={{ color: "#fff", borderColor: "rgba(255,255,255,0.2)" }}
                  >
                    {ID_TYPES.map((t) => (
                      <option key={t.value} value={t.value} style={{ color: "#000" }}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <label
                    htmlFor="age-id-dob"
                    className="mt-3 block text-sm font-semibold"
                    style={{ color: "#fff" }}
                  >
                    Date of birth on the ID
                  </label>
                  <input
                    id="age-id-dob"
                    type="date"
                    value={idDob}
                    onChange={(e) => setIdDob(e.target.value)}
                    className="mt-2 w-full rounded-lg border bg-black px-3 py-2 text-sm"
                    style={{ color: "#fff", borderColor: "rgba(255,255,255,0.2)" }}
                  />
                </div>

                <FilePicker
                  label="Photo of your ID"
                  hint="Front side, all four corners visible, no glare."
                  file={document}
                  onPick={setDocument}
                  inputRef={docRef}
                />
                <FilePicker
                  label="Selfie holding your ID"
                  hint="Your face and the ID in the same photo."
                  file={selfie}
                  onPick={setSelfie}
                  inputRef={selfieRef}
                />

                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!canSubmit}
                  className="flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold disabled:opacity-40"
                  style={{ backgroundColor: MATURE_RED, color: "#fff" }}
                >
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Submitting…
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" /> Submit for review
                    </>
                  )}
                </button>
              </>
            )}

            <p className="flex items-start gap-2 text-[11px]" style={MUTED}>
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Your ID is stored privately. Only you and a Coolerup moderator can see it, it is never
              posted, and it is never shown to other users.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
