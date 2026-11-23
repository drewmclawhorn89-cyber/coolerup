import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Matches 20261221000000_tiktok_linked_accounts.sql without editing generated types.
type AccountRow = {
  user_id: string;
  open_id: string;
  union_id: string | null;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  follower_count: number;
  following_count: number;
  likes_count: number;
  video_count: number;
  scope: string | null;
  access_token: string;
  refresh_token: string;
  access_expires_at: string;
  refresh_expires_at: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

type PublishRow = {
  id: string;
  user_id: string;
  video_id: string | null;
  tiktok_publish_id: string | null;
  status: string;
  mode: string;
  caption: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

type ImportRow = {
  user_id: string;
  tiktok_id: string;
  video_id: string | null;
  imported_at: string;
};

type Table<Row, Required extends keyof Row> = {
  Row: Row;
  Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
  Update: Partial<Row>;
  Relationships: [];
};

type PublicAccount = Pick<AccountRow,
  "open_id" | "username" | "display_name" | "avatar_url" | "follower_count" |
  "following_count" | "likes_count" | "video_count" | "scope" | "last_synced_at"
> & { connected_at: string };

export type TikTokDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables" | "Functions"> & {
    Tables: Database["public"]["Tables"] & {
      tiktok_accounts: Table<AccountRow,
        "user_id" | "open_id" | "username" | "access_token" | "refresh_token" | "access_expires_at"
      >;
      tiktok_publishes: Table<PublishRow, "user_id">;
      tiktok_imports: Table<ImportRow, "user_id" | "tiktok_id">;
    };
    Functions: Database["public"]["Functions"] & {
      my_tiktok_account: { Args: Record<string, never>; Returns: PublicAccount[] };
    };
  };
};

/** Reuse the existing client's auth, transport and RLS; only extend its schema types. */
export function withTikTokSchema(client: unknown): SupabaseClient<TikTokDatabase> {
  return client as SupabaseClient<TikTokDatabase>;
}