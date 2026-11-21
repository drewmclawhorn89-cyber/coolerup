/**
 * A loosely typed handle for tables/RPCs the generated `Database` types don't
 * describe yet (`marketplace_items`, `full_videos`, `stories`, `groups`, the
 * free-coin RPCs, ...).
 *
 * Those modules used to write `supabase as any`, which switched off type
 * checking for every query in the file and tripped `no-explicit-any` 40-odd
 * times. Keeping the single cast here means the rest of the app stays on real
 * types, and when the generated types catch up you only change this file.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const untypedDb = supabase as unknown as SupabaseClient;
