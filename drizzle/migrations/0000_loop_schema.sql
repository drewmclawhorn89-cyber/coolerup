CREATE TABLE public.videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL CHECK (char_length(username) BETWEEN 1 AND 40),
  caption text NOT NULL DEFAULT '' CHECK (char_length(caption) <= 500),
  video_url text NOT NULL,
  likes_count integer NOT NULL DEFAULT 0,
  comments_count integer NOT NULL DEFAULT 0,
  shares_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.videos TO anon, authenticated;
GRANT ALL ON public.videos TO service_role;
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "videos readable" ON public.videos FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "videos insertable" ON public.videos FOR INSERT TO anon, authenticated WITH CHECK (likes_count = 0 AND comments_count = 0 AND shares_count = 0);

CREATE TABLE public.likes (
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  device_id text NOT NULL CHECK (char_length(device_id) BETWEEN 8 AND 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (video_id, device_id)
);
GRANT SELECT, INSERT, DELETE ON public.likes TO anon, authenticated;
GRANT ALL ON public.likes TO service_role;
ALTER TABLE public.likes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "likes readable" ON public.likes FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "likes insertable" ON public.likes FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "likes deletable" ON public.likes FOR DELETE TO anon, authenticated USING (true);

CREATE TABLE public.comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  username text NOT NULL CHECK (char_length(username) BETWEEN 1 AND 40),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.comments TO anon, authenticated;
GRANT ALL ON public.comments TO service_role;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comments readable" ON public.comments FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "comments insertable" ON public.comments FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.sync_counts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'likes' THEN
    IF TG_OP = 'INSERT' THEN UPDATE videos SET likes_count = likes_count + 1 WHERE id = NEW.video_id;
    ELSE UPDATE videos SET likes_count = greatest(likes_count - 1, 0) WHERE id = OLD.video_id; END IF;
  ELSE
    UPDATE videos SET comments_count = comments_count + 1 WHERE id = NEW.video_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER likes_count AFTER INSERT OR DELETE ON public.likes FOR EACH ROW EXECUTE FUNCTION public.sync_counts();
CREATE TRIGGER comments_count AFTER INSERT ON public.comments FOR EACH ROW EXECUTE FUNCTION public.sync_counts();

CREATE OR REPLACE FUNCTION public.increment_share(_video_id uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE videos SET shares_count = shares_count + 1 WHERE id = _video_id;
$$;
GRANT EXECUTE ON FUNCTION public.increment_share(uuid) TO anon, authenticated;

CREATE POLICY "public read videos bucket" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'videos');
CREATE POLICY "public upload videos bucket" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'videos');

INSERT INTO public.videos (username, caption, video_url, created_at) VALUES
('maya.moves', 'Golden hour hits different when you stop trying to be perfect ✨ #reallife', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', now() - interval '1 hour'),
('jordan.out', 'Weekend escape, zero plans, all vibes #explore', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4', now() - interval '2 hours'),
('kai.creates', 'Made this in one take. No filter. #lessperfect', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4', now() - interval '3 hours'),
('sam.daily', 'POV: you finally said yes to the adventure #morereal', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4', now() - interval '4 hours'),
('drew', 'My point of view, unfiltered 🎬 #loop', 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4', now() - interval '5 hours');
