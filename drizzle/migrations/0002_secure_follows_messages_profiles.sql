CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  handle text NOT NULL UNIQUE CHECK (handle ~ '^[a-z0-9._]{1,40}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles readable" ON public.profiles FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "profiles insert own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "profiles update own" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- follows: tied to the signed-in account
ALTER TABLE public.follows ADD COLUMN follower_id uuid;
DROP POLICY "follows insertable" ON public.follows;
DROP POLICY "follows deletable" ON public.follows;
REVOKE INSERT, DELETE ON public.follows FROM anon;
CREATE POLICY "follows insert own" ON public.follows FOR INSERT TO authenticated
  WITH CHECK (follower_id = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.handle = follower_username));
CREATE POLICY "follows delete own" ON public.follows FOR DELETE TO authenticated USING (follower_id = auth.uid());

-- direct messages: private to sender and recipient
ALTER TABLE public.direct_messages ADD COLUMN from_id uuid, ADD COLUMN to_id uuid;
DROP POLICY "dm readable" ON public.direct_messages;
DROP POLICY "dm insertable" ON public.direct_messages;
REVOKE ALL ON public.direct_messages FROM anon;
CREATE POLICY "dm read own" ON public.direct_messages FOR SELECT TO authenticated USING (auth.uid() = from_id OR auth.uid() = to_id);
CREATE POLICY "dm send as self" ON public.direct_messages FOR INSERT TO authenticated
  WITH CHECK (
    from_id = auth.uid()
    AND length(message) BETWEEN 1 AND 2000
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.handle = from_username)
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = to_id AND p.handle = to_username)
  );