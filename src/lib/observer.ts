/**
 * Shared IntersectionObserver pool.
 *
 * Creating one observer per element (and per behaviour) is expensive on low-end
 * phones — a 20-card feed used to spin up ~60 observers. Observers are instead
 * shared by option signature, and callbacks are looked up per element.
 */

type Callback = (entry: IntersectionObserverEntry) => void;

type Entry = { cb: Callback };

const pools = new Map<string, { observer: IntersectionObserver; targets: Map<Element, Entry> }>();

function poolFor(rootMargin: string, threshold: number | number[]) {
  const key = `${rootMargin}|${Array.isArray(threshold) ? threshold.join(",") : threshold}`;
  let pool = pools.get(key);
  if (pool) return pool;

  const targets = new Map<Element, Entry>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) targets.get(entry.target)?.cb(entry);
    },
    { rootMargin, threshold },
  );
  pool = { observer, targets };
  pools.set(key, pool);
  return pool;
}

/**
 * Observe an element with a shared observer. Returns a cleanup function.
 * Safe to call on the server (no-op).
 */
export function observeIntersection(
  el: Element,
  cb: Callback,
  options: { rootMargin?: string; threshold?: number | number[] } = {},
): () => void {
  if (typeof IntersectionObserver === "undefined") return () => {};
  const { rootMargin = "0px", threshold = 0 } = options;
  const pool = poolFor(rootMargin, threshold);
  pool.targets.set(el, { cb });
  pool.observer.observe(el);
  return () => {
    pool.targets.delete(el);
    pool.observer.unobserve(el);
  };
}
