import { useEffect, useState } from "react";
import { resolveAvatarUrl } from "@/components/EditProfileDialog";

/**
 * Round avatar for search rows. `avatar_url` may be a plain URL or a private
 * storage reference (`avatars:path`), so it is resolved lazily and the initial
 * is shown until (or unless) the URL arrives.
 */
export function SearchAvatar({
  name,
  avatarUrl,
  size = 48,
}: {
  name: string;
  avatarUrl: string | null | undefined;
  size?: number;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!avatarUrl) {
      setSrc(null);
      return;
    }
    void resolveAvatarUrl(avatarUrl).then((url) => {
      if (alive) setSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [avatarUrl]);

  const initial = (name.replace(/^@/, "").trim()[0] ?? "?").toUpperCase();

  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#fe2c55] to-[#7a1bff] text-sm font-black text-white"
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        initial
      )}
    </span>
  );
}
