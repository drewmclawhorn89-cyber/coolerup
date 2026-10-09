ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_name text, ADD COLUMN IF NOT EXISTS bio text, ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_bio_len CHECK (bio IS NULL OR length(bio) <= 160) NOT VALID;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_name_len CHECK (display_name IS NULL OR length(display_name) <= 50) NOT VALID;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_avatar_len CHECK (avatar_url IS NULL OR length(avatar_url) <= 200000) NOT VALID;

CREATE OR REPLACE FUNCTION public.rename_handle() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.handle <> OLD.handle THEN
    UPDATE videos SET username = NEW.handle WHERE username = OLD.handle;
    UPDATE comments SET username = NEW.handle WHERE username = OLD.handle;
    UPDATE follows SET follower_username = NEW.handle WHERE follower_id = NEW.id;
    UPDATE follows SET following_username = NEW.handle WHERE following_username = OLD.handle;
    UPDATE direct_messages SET from_username = NEW.handle WHERE from_id = NEW.id;
    UPDATE direct_messages SET to_username = NEW.handle WHERE to_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER profiles_rename AFTER UPDATE OF handle ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.rename_handle();

CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roles read own" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE TABLE public.banned_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  reason text,
  banned_by text,
  banned_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  is_permanent boolean NOT NULL DEFAULT false
);
GRANT SELECT ON public.banned_users TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.banned_users TO authenticated;
GRANT ALL ON public.banned_users TO service_role;
ALTER TABLE public.banned_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bans readable" ON public.banned_users FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admins insert bans" ON public.banned_users FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update bans" ON public.banned_users FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete bans" ON public.banned_users FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.is_banned(_username text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.banned_users WHERE username = _username AND (is_permanent OR expires_at IS NULL OR expires_at > now()))
$$;

CREATE TABLE public.reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL,
  reporter_username text NOT NULL,
  reported_username text NOT NULL,
  reported_video_id text,
  reason text NOT NULL CHECK (reason IN ('spam','nudity','harassment','hate','violence','scam','minor','other')),
  details text CHECK (details IS NULL OR length(details) <= 1000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','dismissed','actioned')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.reports TO authenticated;
GRANT ALL ON public.reports TO service_role;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "report as self" ON public.reports FOR INSERT TO authenticated WITH CHECK (reporter_id = auth.uid() AND status = 'pending');
CREATE POLICY "admins read reports" ON public.reports FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update reports" ON public.reports FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.blocked_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id uuid NOT NULL,
  blocker_username text NOT NULL,
  blocked_username text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_username)
);
GRANT SELECT, INSERT, DELETE ON public.blocked_users TO authenticated;
GRANT ALL ON public.blocked_users TO service_role;
ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blocks read own" ON public.blocked_users FOR SELECT TO authenticated USING (blocker_id = auth.uid());
CREATE POLICY "blocks insert own" ON public.blocked_users FOR INSERT TO authenticated WITH CHECK (blocker_id = auth.uid());
CREATE POLICY "blocks delete own" ON public.blocked_users FOR DELETE TO authenticated USING (blocker_id = auth.uid());

CREATE TABLE public.muted_words (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  word text UNIQUE NOT NULL
);
GRANT SELECT ON public.muted_words TO anon, authenticated;
GRANT INSERT, DELETE ON public.muted_words TO authenticated;
GRANT ALL ON public.muted_words TO service_role;
ALTER TABLE public.muted_words ENABLE ROW LEVEL SECURITY;
CREATE POLICY "muted words readable" ON public.muted_words FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "admins add muted words" ON public.muted_words FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins remove muted words" ON public.muted_words FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "no banned uploads" ON public.videos AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (NOT public.is_banned(username));
CREATE POLICY "no banned comments" ON public.comments AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (NOT public.is_banned(username));
CREATE POLICY "no banned messages" ON public.direct_messages AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT public.is_banned(from_username));