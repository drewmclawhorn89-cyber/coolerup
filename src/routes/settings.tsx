import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, LogOut, Pencil, ShieldCheck, UserRound } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { EditProfileDialog } from "@/components/EditProfileDialog";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Coolerup" },
      { name: "description", content: "Manage your Coolerup profile and account settings." },
      { property: "og:title", content: "Settings — Coolerup" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Settings,
});

function Settings() {
  const auth = useAuth();
  const [editing, setEditing] = useState(false);

  if (auth.ready && !auth.user) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <p className="font-display text-2xl">Settings</p>
        <p className="max-w-sm text-muted-foreground">Sign in to manage your profile, username, and account preferences.</p>
        <Button onClick={auth.signIn}>Sign in with Google</Button>
        <Link to="/" className="text-sm text-muted-foreground">Back to home</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 pb-10 pt-6">
      <div className="flex items-center gap-3">
        <Link to="/" aria-label="Back to home" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-display text-2xl">Settings</h1>
      </div>

      <div className="mt-6 rounded-2xl border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-4">
          {auth.avatar ? (
            <img src={auth.avatar} alt={auth.name ?? "Profile avatar"} className="h-14 w-14 rounded-full object-cover" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary font-display text-xl uppercase text-primary-foreground">
              {auth.name?.[0] ?? "U"}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{auth.name ?? "Your profile"}</p>
            <p className="text-sm text-muted-foreground">@{auth.handle ?? "your-handle"}</p>
          </div>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <Button variant="outline" className="w-full justify-start" onClick={() => setEditing(true)}>
          <Pencil className="mr-2 h-4 w-4" />
          Edit profile
        </Button>

        {auth.handle && (
          <Link
            to="/u/$username"
            params={{ username: auth.handle }}
            className="flex w-full items-center justify-start rounded-md border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            <UserRound className="mr-2 h-4 w-4" />
            View profile
          </Link>
        )}

        <Button variant="outline" className="w-full justify-start" onClick={auth.signOut}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </Button>
      </div>

      <div className="mt-8 rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Account</h2>
        </div>
        <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li>• Profile info and avatar editing</li>
          <li>• Username and handle management</li>
          <li>• Sign-out controls</li>
        </ul>
      </div>

      {auth.user && <EditProfileDialog open={editing} onOpenChange={setEditing} />}
    </div>
  );
}
