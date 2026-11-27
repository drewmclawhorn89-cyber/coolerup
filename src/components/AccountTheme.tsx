import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";
import { toast } from "sonner";

export const accents = {
  light: "#ffffff",
  dark: "#fafafa",
  system: "#e5e7eb",
  blue: "#2563EB",
  purple: "#9333EA",
  pink: "#EC4899",
  green: "#16A34A",
  red: "#DC2626",
};
const valid = (value: unknown): value is keyof typeof accents =>
  typeof value === "string" && Object.hasOwn(accents, value);
const Context = createContext({
  theme: "dark",
  saving: false,
  changeTheme: (_value: string) => {},
});
export const useAccountTheme = () => useContext(Context);

export function AccountTheme({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return (
    <SessionTheme
      phone={user?.app_metadata?.["firebaseSession"] === true}
      key={user?.id ?? "guest"}
      accountId={user?.id}
      saved={user?.user_metadata?.["theme"]}
    >
      {children}
    </SessionTheme>
  );
}

function SessionTheme({
  accountId,
  phone,
  saved,
  children,
}: {
  phone: boolean;
  accountId: string | undefined;
  saved: unknown;
  children: ReactNode;
}) {
  const [pending, setPending] = useState<keyof typeof accents | null>(null);
  const busy = useRef(false);
  const [phoneTheme, setPhoneTheme] = useState<unknown>(null);
  useEffect(() => {
    if (!phone || !accountId) return;
    const store = getFirebaseDb();
    if (!store) return;
    return onSnapshot(
      doc(store, "accountThemes", accountId),
      (snapshot) => setPhoneTheme(snapshot.data()?.["theme"]),
      () => toast.error("Couldn’t load your theme."),
    );
  }, [phone, accountId]);
  const stored = phone ? phoneTheme : saved;
  const theme = pending ?? (valid(stored) ? stored : "dark");
  useEffect(() => {
    document.documentElement.style.setProperty("--account-accent", accents[theme]);
    return () => {
      document.documentElement.style.removeProperty("--account-accent");
    };
  }, [theme]);
  async function changeTheme(value: string) {
    if (!accountId || !valid(value) || busy.current) return;
    busy.current = true;
    setPending(value);
    try {
      if (phone) {
        const store = getFirebaseDb();
        if (!store || getFirebaseAuth()?.currentUser?.uid !== accountId)
          throw new Error("No matching account");
        await setDoc(doc(store, "accountThemes", accountId), { theme: value });
        return;
      }
      const session = await supabase.auth.getSession();
      if (session.data.session?.user.id !== accountId) throw new Error("No matching account");
      const { error } = await supabase.auth.updateUser({ data: { theme: value } });
      if (error) throw error;
    } catch {
      toast.error("Couldn’t save your theme. Try again.");
    } finally {
      busy.current = false;
      setPending(null);
    }
  }
  return (
    <Context.Provider value={{ theme, changeTheme, saving: pending !== null }}>
      {children}
    </Context.Provider>
  );
}
