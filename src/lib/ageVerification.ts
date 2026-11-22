/**
 * Coolerup · Real ID verification (browser side)
 *
 * The Date of Birth on an account is typed in by the user, so it proves
 * nothing. 18+ videos therefore stay locked until a moderator has approved a
 * government ID photo and a matching selfie.
 *
 * This module is the only client entry point:
 *   - `useAgeVerification()` reads the caller's own status
 *   - `submitAgeVerification()` uploads the two images and files the request
 *   - `signedAgeDocUrl()` lets the owner (or an admin) preview an upload
 *
 * The status column is never written from here. `submit_age_verification()`
 * forces `pending`, and only `admin_review_age_verification()` can approve.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** Private bucket. Never public: these are identity documents. */
export const AGE_VERIFY_BUCKET = "age-verification";

/** Max size per image. A phone photo of an ID is well under this. */
export const AGE_DOC_MAX_BYTES = 12 * 1024 * 1024;

/** Accepted image types for both uploads. */
export const AGE_DOC_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";

export type AgeVerificationStatus = "none" | "pending" | "approved" | "rejected";

export type AgeVerification = {
  status: AgeVerificationStatus;
  documentType: string | null;
  country: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
};

export const ID_TYPES = [
  { value: "drivers_license", label: "Driver's license" },
  { value: "passport", label: "Passport" },
  { value: "state_id", label: "State ID card" },
  { value: "national_id", label: "National ID card" },
] as const;

export type IdType = (typeof ID_TYPES)[number]["value"];

/** Copy shown wherever an 18+ video is locked. */
export const AGE_VERIFY_REQUIRED_MESSAGE = "Verify your ID to watch 18+ videos";

/** Copy shown when a check is already in the moderator queue. */
export const AGE_VERIFY_PENDING_MESSAGE =
  "Your ID is being reviewed. 18+ videos unlock once it's approved.";

/** Copy shown after a rejection. */
export const AGE_VERIFY_REJECTED_MESSAGE =
  "Your ID check was rejected. Submit a new photo to try again.";

/** Copy shown when the account has no Date of Birth at all. */
export const AGE_DOB_MISSING_MESSAGE = "Add your date of birth in Settings first";

const EMPTY: AgeVerification = {
  status: "none",
  documentType: null,
  country: null,
  submittedAt: null,
  reviewedAt: null,
  rejectionReason: null,
};

function normaliseStatus(value: unknown): AgeVerificationStatus {
  return value === "pending" || value === "approved" || value === "rejected" ? value : "none";
}

/**
 * Reads the caller's own verification row.
 *
 * `my_age_verification()` is SECURITY DEFINER and filtered to `auth.uid()`, so
 * this can never return somebody else's check. A signed-out caller gets `none`.
 */
export async function fetchAgeVerification(): Promise<AgeVerification> {
  const { data, error } = await supabase.rpc("my_age_verification");
  if (error) {
    // The migration may not be applied yet. Treat that as "not verified"
    // rather than throwing: the gate must fail closed, not crash the feed.
    return EMPTY;
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        status?: string | null;
        document_type?: string | null;
        country?: string | null;
        submitted_at?: string | null;
        reviewed_at?: string | null;
        rejection_reason?: string | null;
      }
    | null
    | undefined;
  if (!row) return EMPTY;
  return {
    status: normaliseStatus(row.status),
    documentType: row.document_type ?? null,
    country: row.country ?? null,
    submittedAt: row.submitted_at ?? null,
    reviewedAt: row.reviewed_at ?? null,
    rejectionReason: row.rejection_reason ?? null,
  };
}

/**
 * Verification state for the current viewer.
 *
 * `approved` is the only status that unlocks 18+ content. `loading` stays true
 * until the first read settles so a card never flashes an unlocked video before
 * the answer arrives.
 */
export function useAgeVerification(enabled = true) {
  const [verification, setVerification] = useState<AgeVerification>(EMPTY);
  const [loading, setLoading] = useState(enabled);
  const [checked, setChecked] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchAgeVerification();
      setVerification(next);
    } finally {
      setLoading(false);
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setChecked(true);
      return;
    }
    let alive = true;
    void (async () => {
      const next = await fetchAgeVerification();
      if (!alive) return;
      setVerification(next);
      setLoading(false);
      setChecked(true);
    })();
    return () => {
      alive = false;
    };
  }, [enabled]);

  return {
    verification,
    status: verification.status,
    approved: verification.status === "approved",
    pending: verification.status === "pending",
    rejected: verification.status === "rejected",
    loading,
    checked,
    refresh,
  };
}

function extensionFor(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/heic" || file.type === "image/heif") return "heic";
  return "jpg";
}

async function uploadOne(userId: string, kind: "id" | "selfie", file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Upload a photo, not a document file.");
  }
  if (file.size === 0) throw new Error("That file is empty. Pick another photo.");
  if (file.size > AGE_DOC_MAX_BYTES) {
    throw new Error(
      `That photo is ${(file.size / (1024 * 1024)).toFixed(0)} MB. The limit is 12 MB.`,
    );
  }
  const path = `${userId}/${kind}-${crypto.randomUUID()}.${extensionFor(file)}`;
  const { error } = await supabase.storage
    .from(AGE_VERIFY_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: true });
  if (error) throw error;
  return path;
}

/**
 * Uploads the ID photo and the selfie, then files the check.
 *
 * Both objects land in the caller's own folder, and the RPC re-checks that
 * prefix server-side, so a submission can never point at someone else's file.
 */
export async function submitAgeVerification(input: {
  document: File;
  selfie: File;
  documentType: IdType;
  country?: string | null;
  idDateOfBirth?: string | null;
}): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in to verify your ID");

  const documentPath = await uploadOne(user.id, "id", input.document);
  let selfiePath: string;
  try {
    selfiePath = await uploadOne(user.id, "selfie", input.selfie);
  } catch (err) {
    // Don't leave an orphaned ID photo behind if the second upload fails.
    await supabase.storage.from(AGE_VERIFY_BUCKET).remove([documentPath]);
    throw err;
  }

  const { error } = await supabase.rpc("submit_age_verification", {
    _document_type: input.documentType,
    _document_path: documentPath,
    _selfie_path: selfiePath,
    _country: input.country ?? null,
    _id_date_of_birth: input.idDateOfBirth ?? null,
  });
  if (error) {
    await supabase.storage.from(AGE_VERIFY_BUCKET).remove([documentPath, selfiePath]);
    throw error;
  }
}

/** Short-lived preview URL for an upload the caller is allowed to read. */
export async function signedAgeDocUrl(path: string, seconds = 300): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from(AGE_VERIFY_BUCKET)
    .createSignedUrl(path, seconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}
