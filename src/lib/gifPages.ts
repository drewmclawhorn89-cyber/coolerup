import { supabase } from "@/integrations/supabase/client";
import type { GifRow } from "@/lib/gif";

const GIF_COLS = "id, user_id, gif_url, title, is_public, source_video_id, use_count, created_at";

/** Fetch one page of public Coolerup GIFs for the picker. */
export async function listPublicGifPage(
  query: string,
  offset: number,
  limit = 20,
): Promise<GifRow[]> {
  let request = supabase
    .from("gifs")
    .select(GIF_COLS)
    .eq("is_public", true)
    .order("created_at", { ascending: false });

  const term = query.trim().replace(/[%_]/g, "");
  if (term) request = request.ilike("title", `%${term}%`);

  const { data, error } = await request.range(offset, offset + limit - 1);
  if (error) throw error;

  const rows = (data ?? []) as GifRow[];
  const ids = [...new Set(rows.map((row) => row.user_id).filter((id): id is string => !!id))];
  if (ids.length === 0) return rows;

  const { data: profiles } = await supabase.from("profiles").select("id, handle").in("id", ids);
  const handles = new Map(
    ((profiles ?? []) as { id: string; handle: string }[]).map((profile) => [profile.id, profile.handle]),
  );
  return rows.map((row) => ({
    ...row,
    username: row.user_id ? (handles.get(row.user_id) ?? null) : null,
  }));
}
