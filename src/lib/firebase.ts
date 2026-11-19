import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut,
  type Auth,
  type ConfirmationResult,
  type User as FirebaseUser,
} from "firebase/auth";

export type FirebasePhoneConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
};

export type FirebasePhoneError = {
  code?: string | undefined;
  message: string;
};

// Public Firebase web config (safe to ship in client code).
const FIREBASE_DEFAULTS: Record<string, string> = {
  VITE_FIREBASE_API_KEY: "AIzaSyCFhH-JLAmkx0mCtUO7Bj2PXCr_XaWuOOI",
  VITE_FIREBASE_AUTH_DOMAIN: "coolerup-95946.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "coolerup-95946",
  VITE_FIREBASE_STORAGE_BUCKET: "coolerup-95946.firebasestorage.app",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "52316688457",
  VITE_FIREBASE_APP_ID: "1:52316688457:web:ed9d905a4407914bd26f98",
};

function readEnv(key: string): string {
  const value = (import.meta.env as Record<string, string | undefined>)[key];
  const v = typeof value === "string" ? value.trim() : "";
  return v || FIREBASE_DEFAULTS[key] || "";
}

export function getFirebasePhoneConfig(): FirebasePhoneConfig | null {
  const apiKey = readEnv("VITE_FIREBASE_API_KEY");
  const authDomain = readEnv("VITE_FIREBASE_AUTH_DOMAIN");
  const projectId = readEnv("VITE_FIREBASE_PROJECT_ID");

  if (!apiKey || !authDomain || !projectId) return null;

  const appId = readEnv("VITE_FIREBASE_APP_ID");
  const storageBucket = readEnv("VITE_FIREBASE_STORAGE_BUCKET");
  const messagingSenderId = readEnv("VITE_FIREBASE_MESSAGING_SENDER_ID");

  return {
    apiKey,
    authDomain,
    projectId,
    ...(appId ? { appId } : {}),
    ...(storageBucket ? { storageBucket } : {}),
    ...(messagingSenderId ? { messagingSenderId } : {}),
  };
}

export function isFirebaseConfigured(): boolean {
  return getFirebasePhoneConfig() !== null;
}

export function getFirebaseConfigSummary(): {
  configured: boolean;
  projectId: string | null;
  authDomain: string | null;
} {
  const cfg = getFirebasePhoneConfig();
  if (!cfg) {
    return { configured: false, projectId: null, authDomain: null };
  }
  return {
    configured: true,
    projectId: cfg.projectId,
    authDomain: cfg.authDomain,
  };
}

let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;
let activeVerifier: RecaptchaVerifier | null = null;

export function getFirebaseAuth(): Auth | null {
  if (typeof window === "undefined") return null;
  const cfg = getFirebasePhoneConfig();
  if (!cfg) return null;
  if (cachedAuth) return cachedAuth;

  cachedApp = getApps().length > 0 ? getApp() : initializeApp(cfg);
  cachedAuth = getAuth(cachedApp);
  return cachedAuth;
}

export function clearFirebaseRecaptcha(container?: HTMLElement | null): void {
  if (activeVerifier) {
    try {
      activeVerifier.clear();
    } catch {
      // Ignore already-cleared widget errors during unmount/retry.
    }
    activeVerifier = null;
  }
  if (container) {
    container.innerHTML = "";
  }
}

function toFirebaseError(err: unknown, fallback: string): FirebasePhoneError {
  if (err && typeof err === "object") {
    const code = "code" in err && typeof err.code === "string" ? err.code : undefined;
    const message =
      "message" in err && typeof err.message === "string" && err.message.trim()
        ? err.message
        : fallback;
    return { code, message };
  }
  return { message: fallback };
}

export async function sendFirebasePhoneCode(
  phoneNumber: string,
  container: HTMLElement,
): Promise<
  | { confirmation: ConfirmationResult; error?: undefined }
  | { confirmation?: undefined; error: FirebasePhoneError }
> {
  const auth = getFirebaseAuth();
  if (!auth) {
    return {
      error: {
        code: "firebase/not-configured",
        message: "Firebase Phone Auth is not configured in environment variables.",
      },
    };
  }

  clearFirebaseRecaptcha(container);
  try {
    const verifier = new RecaptchaVerifier(auth, container, { size: "invisible" });
    activeVerifier = verifier;
    const confirmation = await signInWithPhoneNumber(auth, phoneNumber, verifier);
    return { confirmation };
  } catch (err) {
    clearFirebaseRecaptcha(container);
    return { error: toFirebaseError(err, "Couldn't send verification text") };
  }
}

export async function confirmFirebasePhoneCode(
  confirmation: ConfirmationResult,
  code: string,
): Promise<
  { user: FirebaseUser; error?: undefined } | { user?: undefined; error: FirebasePhoneError }
> {
  try {
    const cred = await confirmation.confirm(code);
    clearFirebaseRecaptcha();
    return { user: cred.user };
  } catch (err) {
    return { error: toFirebaseError(err, "Invalid verification code") };
  }
}

export function onFirebasePhoneUserChange(cb: (user: FirebaseUser | null) => void): () => void {
  const auth = getFirebaseAuth();
  if (!auth) {
    cb(null);
    return () => {};
  }
  return onAuthStateChanged(auth, cb);
}

export async function signOutFirebasePhone(): Promise<void> {
  const auth = getFirebaseAuth();
  if (!auth) return;
  try {
    await signOut(auth);
  } catch {
    // Best-effort sign-out so Supabase sign-out still completes.
  }
}
