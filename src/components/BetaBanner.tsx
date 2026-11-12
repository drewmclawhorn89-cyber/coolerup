export function BetaBanner() {
  return (
    <div
      role="status"
      className="sticky top-0 z-50 w-full bg-warning px-4 py-2 text-center text-sm font-bold text-warning-foreground"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.5rem)" }}
    >
      🧪 BETA — Testing New Stuff — Not Public
    </div>
  );
}
