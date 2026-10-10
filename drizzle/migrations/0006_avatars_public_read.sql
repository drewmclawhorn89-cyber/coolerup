DROP POLICY "avatars read own" ON storage.objects;
CREATE POLICY "avatars readable" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'avatars');