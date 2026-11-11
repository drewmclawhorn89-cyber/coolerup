import { createServerFn } from "@tanstack/react-start";

/**
 * Hands the Giphy key to the browser at request time.
 *
 * `VITE_*` variables are inlined into the bundle at build time, so changing
 * one requires a full rebuild before the browser ever sees the new value.
 * That is a terrible fit for "I added the key, why is it still broken?" —
 * the answer is always "because the build predates the variable".
 *
 * This server function reads the environment when the request is served, so
 * setting `GIPHY_API_KEY` on the host and restarting is enough; no rebuild.
 * `VITE_GIPHY_API_KEY` is still honoured as a fallback for builds that bake
 * it in.
 *
 * The key is public by nature — it ships inside the client bundle either way —
 * so returning it here leaks nothing that wasn't already visible. Restrict it
 * by domain in the Giphy dashboard rather than trying to keep it secret.
 */
export const getGiphyKey = createServerFn({ method: "GET" }).handler(async () => {
  const key =
    process.env["GIPHY_API_KEY"] ?? process.env["VITE_GIPHY_API_KEY"] ?? "";
  return { key: key.trim() };
});
