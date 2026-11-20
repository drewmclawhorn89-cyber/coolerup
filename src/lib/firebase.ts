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
import { doc, getDocFromServer, getFirestore, type Firestore } from "firebase/firestore";
import firebaseAppletConfig from "../../firebase-applet-config.json";

export type FirebasePhoneConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  measurementId?: string;
  firestoreDatabaseId?: string;
};

export type FirebasePhoneError = {
  code?: string | undefined;
  message: string;
};

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

// Public Firebase web config loaded from firebase-applet-config.json (overridable via VITE_*).
const FIREBASE_DEFAULTS: Record<string, string> = {
  VITE_FIREBASE_API_KEY: firebaseAppletConfig.apiKey || "AIzaSyCFhH-JLAmkx0mCtUO7Bj2PXCr_XaWuOOI",
  VITE_FIREBASE_AUTH_DOMAIN: firebaseAppletConfig.authDomain || "coolerup-95946.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: firebaseAppletConfig.projectId || "coolerup-95946",
  VITE_FIREBASE_STORAGE_BUCKET:
    firebaseAppletConfig.storageBucket || "coolerup-95946.firebasestorage.app",
  VITE_FIREBASE_MESSAGING_SENDER_ID: firebaseAppletConfig.messagingSenderId || "52316688457",
  VITE_FIREBASE_APP_ID: firebaseAppletConfig.appId || "1:52316688457:web:300831d4b76c1175d26f98",
  VITE_FIREBASE_MEASUREMENT_ID: firebaseAppletConfig.measurementId || "G-2LR4EWJ3DM",
  VITE_FIREBASE_FIRESTORE_DATABASE_ID:
    firebaseAppletConfig.firestoreDatabaseId ||
    "ai-studio-coolerup-cb23dc12-2877-4aed-b1e4-2c238632ccae",
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
  const measurementId = readEnv("VITE_FIREBASE_MEASUREMENT_ID");
  const firestoreDatabaseId = readEnv("VITE_FIREBASE_FIRESTORE_DATABASE_ID");

  return {
    apiKey,
    authDomain,
    projectId,
    ...(appId ? { appId } : {}),
    ...(storageBucket ? { storageBucket } : {}),
    ...(messagingSenderId ? { messagingSenderId } : {}),
    ...(measurementId ? { measurementId } : {}),
    ...(firestoreDatabaseId ? { firestoreDatabaseId } : {}),
  };
}

export function getFirestoreDatabaseId(): string {
  return (
    readEnv("VITE_FIREBASE_FIRESTORE_DATABASE_ID") ||
    firebaseAppletConfig.firestoreDatabaseId ||
    "(default)"
  );
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
let cachedDb: Firestore | null = null;
let connectionTested = false;
let activeVerifier: RecaptchaVerifier | null = null;

export function getFirebaseApp(): FirebaseApp | null {
  if (typeof window === "undefined") return null;
  const cfg = getFirebasePhoneConfig();
  if (!cfg) return null;
  if (cachedApp) return cachedApp;
  cachedApp = getApps().length > 0 ? getApp() : initializeApp(cfg);
  return cachedApp;
}

export function getFirebaseAuth(): Auth | null {
  const app = getFirebaseApp();
  if (!app) return null;
  if (cachedAuth) return cachedAuth;
  cachedAuth = getAuth(app);
  return cachedAuth;
}

export function buildFirestoreErrorInfo(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): FirestoreErrorInfo {
  const currentUser = getFirebaseAuth()?.currentUser;
  return {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    authInfo: {
      userId: currentUser?.uid ?? null,
      email: currentUser?.email ?? null,
      emailVerified: currentUser?.emailVerified ?? null,
      isAnonymous: currentUser?.isAnonymous ?? null,
      tenantId: currentUser?.tenantId ?? null,
      providerInfo:
        currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) ?? [],
    },
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo = buildFirestoreErrorInfo(error, operationType, path);
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(db: Firestore): Promise<void> {
  if (connectionTested || import.meta.env.MODE === "test") return;
  connectionTested = true;
  try {
    await getDocFromServer(doc(db, "test", "connection"));
  } catch (error) {
    if (error instanceof Error && error.message.includes("the client is offline")) {
      console.error("Please check your Firebase configuration.");
    }
  }
}

export function getFirebaseDb(): Firestore | null {
  const app = getFirebaseApp();
  if (!app) return null;
  if (cachedDb) return cachedDb;
  const databaseId = getFirestoreDatabaseId();
  cachedDb =
    databaseId && databaseId !== "(default)" ? getFirestore(app, databaseId) : getFirestore(app);
  void testFirestoreConnection(cachedDb);
  return cachedDb;
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
