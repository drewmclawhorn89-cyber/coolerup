/**
 * A string of blinking red/green Christmas lights, used as the border on the
 * top tabs (Home, Following, For You, Marketplace, Groups, LIVE) while the
 * Christmas update is live. Decorative only.
 */
export function ChristmasLights({
  count = 22,
  className = "",
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={`christmas-lights pointer-events-none absolute inset-x-0 top-0 ${className}`}
    >
      <span className="christmas-lights-wire" />
      <div className="flex items-start justify-between px-1">
        {Array.from({ length: count }, (_, i) => (
          <span
            key={i}
            className={`christmas-bulb ${i % 2 === 0 ? "christmas-bulb-red" : "christmas-bulb-green"}`}
            style={{ animationDelay: `${(i % 5) * 0.28}s` }}
          />
        ))}
      </div>
    </div>
  );
}
