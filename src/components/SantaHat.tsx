/**
 * Santa hat that sits on the pink dot of the coolerup. logo while the Christmas
 * update is live. Inline SVG so it stays crisp at any size and needs no asset.
 */
export function SantaHat({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 56"
      className={className}
      aria-hidden
      focusable="false"
      role="presentation"
    >
      {/* cone */}
      <path d="M10 40 C14 20 26 8 44 6 C36 16 34 28 40 40 Z" fill="#d81b1b" />
      {/* fold */}
      <path d="M30 40 C31 28 36 16 44 6 C40 22 38 32 40 40 Z" fill="#a30f0f" opacity="0.55" />
      {/* fur brim */}
      <rect x="4" y="37" width="44" height="11" rx="5.5" fill="#fff" />
      <rect x="4" y="43" width="44" height="5" rx="2.5" fill="#dbe2ea" opacity="0.7" />
      {/* pom-pom */}
      <circle cx="47" cy="7" r="7" fill="#fff" />
      <circle cx="45" cy="5" r="3" fill="#e6ebf1" opacity="0.9" />
    </svg>
  );
}
