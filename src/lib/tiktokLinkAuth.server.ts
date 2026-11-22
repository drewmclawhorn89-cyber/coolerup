/**
 * Resolves the signed-in Coolerup user from an incoming request.
 *
 * The browser calls these TikTok routes with its Supabase access token in the
 * `Authorization: Bearer …` header. We verify it against Supabase rather than
 * trusting anything in the body, so a caller can only ever act on their own
 * linked TikTok account.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type Caller = { userId: string; email: string | null };

export async function callerFromRequest(request: Request): Promise<Caller | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  return { userId: data.user.id, email: data.user.email ?? null };
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

export function jsonOk(payload: Record<string, unknown>) {
  return Response.json(payload, { headers: { "cache-control": "no-store" } });
}
