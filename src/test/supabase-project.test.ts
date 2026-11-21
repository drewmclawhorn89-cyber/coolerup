import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUPABASE_URL,
  SUPABASE_PROJECT_ID,
  resolveSupabaseUrl,
} from "@/integrations/supabase/project";

describe("supabase project URL", () => {
  it("derives the public project URL when no URL is configured", () => {
    // This is the exact production failure: the publishable key was present but
    // VITE_SUPABASE_URL was not, so the client fell back to the offline mock.
    expect(resolveSupabaseUrl(undefined)).toBe(DEFAULT_SUPABASE_URL);
    expect(resolveSupabaseUrl("")).toBe(DEFAULT_SUPABASE_URL);
    expect(resolveSupabaseUrl("   ")).toBe(DEFAULT_SUPABASE_URL);
  });

  it("keeps an explicitly configured URL and trims trailing slashes", () => {
    expect(resolveSupabaseUrl("https://example.supabase.co/")).toBe("https://example.supabase.co");
  });

  it("points at the real project ref", () => {
    expect(DEFAULT_SUPABASE_URL).toBe(`https://${SUPABASE_PROJECT_ID}.supabase.co`);
  });
});
