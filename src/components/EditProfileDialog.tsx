import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, refreshProfile } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";

const AVATAR_PREFIX = "avatars:";

/** Turn a stored avatar reference into a viewable URL (signed, 6h). */
export async function resolveAvatarUrl(url: string | null | undefined) {
  if (!url) return null;
  if (!url.startsWith(AVATAR_PREFIX)) return url;
  const { data } = await supabase.storage
    .from("avatars")
    .createSignedUrl(url.slice(AVATAR_PREFIX.length), 60 * 60 * 6);
  return data?.signedUrl ?? null;
}

export function EditProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const auth = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setDisplayName(auth.profile?.display_name || auth.name || "");
    setBio(auth.profile?.bio || "");
    setPhoto(null);
    let revoked: string | null = null;
    resolveAvatarUrl(auth.profile?.avatar_url).then((u) => setPreview(u));
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [open, auth.profile?.id]);

  const pickPhoto = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Pick an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Photos must be under 5 MB");
      return;
    }
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  };

  const save = async () => {
    if (!auth.user || !auth.profile) return;
    const name = displayName.trim();
    if (name.length > 60) {
      toast.error("Display name must be 60 characters or less");
      return;
    }
    if (bio.length > 160) {
      toast.error("Bio must be 160 characters or less");
      return;
    }
    setSaving(true);
    try {
      let avatarUrl = auth.profile.avatar_url;
      if (photo) {
        const ext = photo.name.split(".").pop() || "jpg";
        const path = `${auth.user.id}/avatar.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("avatars")
          .upload(path, photo, { contentType: photo.type, upsert: true });
        if (upErr) throw upErr;
        avatarUrl = AVATAR_PREFIX + path;
      }
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: name || null, bio: bio.trim() || null, avatar_url: avatarUrl })
        .eq("id", auth.user.id);
      if (error) throw error;
      refreshProfile();
      toast.success("Profile updated");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || "Couldn't save your profile");
    } finally {
      setSaving(false);
    }
  };

  const initial = (displayName || auth.handle || "?").charAt(0).toUpperCase() || "?";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm border-border bg-card">
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="group relative h-24 w-24 overflow-hidden rounded-full bg-primary text-3xl uppercase text-primary-foreground"
          >
            {preview ? (
              <img src={preview} alt="Profile photo" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center">{initial}</span>
            )}
            <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition group-hover:opacity-100">
              <Camera className="h-4 w-4 text-white" />
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)}
          />

          <div className="w-full space-y-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Display name</label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={60}
                placeholder="Your name"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                Bio <span className="opacity-60">({bio.length}/160)</span>
              </label>
              <Textarea
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, 160))}
                rows={3}
                placeholder="Tell people a little about you"
              />
            </div>
            <p className="text-xs text-muted-foreground">Username: @{auth.handle}</p>
          </div>

          <Button onClick={save} disabled={saving} className="w-full">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
