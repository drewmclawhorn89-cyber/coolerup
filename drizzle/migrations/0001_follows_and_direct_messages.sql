CREATE TABLE public.follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_username text NOT NULL,
  following_username text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (follower_username, following_username)
);
GRANT SELECT, INSERT, DELETE ON public.follows TO anon, authenticated;
GRANT ALL ON public.follows TO service_role;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "follows readable" ON public.follows FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "follows insertable" ON public.follows FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "follows deletable" ON public.follows FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE public.direct_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_username text NOT NULL,
  to_username text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.direct_messages TO anon, authenticated;
GRANT ALL ON public.direct_messages TO service_role;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dm readable" ON public.direct_messages FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "dm insertable" ON public.direct_messages FOR INSERT TO anon, authenticated WITH CHECK (length(message) BETWEEN 1 AND 2000);