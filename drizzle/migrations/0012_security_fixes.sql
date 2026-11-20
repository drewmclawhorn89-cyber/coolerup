-- group_members: only safe self-join path; reads scoped to public groups / members
drop policy if exists "Users join groups" on public.group_members;
drop policy if exists "group members insert" on public.group_members;
drop policy if exists "Users can insert their own membership" on public.group_members;
drop policy if exists "Members are public" on public.group_members;
drop policy if exists "group members read" on public.group_members;
drop policy if exists "members readable" on public.group_members;
create policy "members visible in public groups or to members" on public.group_members
  for select to anon, authenticated using (
    user_id = auth.uid()
    or public.is_group_member(group_id)
    or exists (select 1 from public.groups g where g.id = group_id and g.privacy = 'public')
  );

-- profiles: clients can never write is_admin
revoke insert, update on public.profiles from anon, authenticated;
grant insert (id, handle, display_name, bio, avatar_url, links, username, birthday, onboarding_complete, venmo_handle, show_liked)
  on public.profiles to authenticated;
grant update (handle, display_name, bio, avatar_url, links, username, birthday, onboarding_complete, venmo_handle, show_liked)
  on public.profiles to authenticated;

-- promo codes: deactivate all seeded/known codes
update public.subscription_codes set active = false;

-- follower reward: not callable by clients
revoke execute on function public.award_first_follower_reward(uuid, text) from public, anon, authenticated;

-- social/live tables: signed-in readers only
drop policy if exists "comment likes are viewable by everyone" on public.comment_likes;
create policy "signed-in read comment likes" on public.comment_likes for select to authenticated using (auth.uid() is not null);
drop policy if exists "full video comment likes are viewable by everyone" on public.full_video_comment_likes;
create policy "signed-in read full video comment likes" on public.full_video_comment_likes for select to authenticated using (auth.uid() is not null);
drop policy if exists "Story likes are public" on public.story_likes;
create policy "signed-in read story likes" on public.story_likes for select to authenticated using (auth.uid() is not null);
drop policy if exists "live mutes are public" on public.live_mutes;
create policy "signed-in read live mutes" on public.live_mutes for select to authenticated using (auth.uid() is not null);
drop policy if exists "live guests are public" on public.live_guests;
create policy "signed-in read live guests" on public.live_guests for select to authenticated using (auth.uid() is not null);
drop policy if exists "live room state is public" on public.live_room_state;
create policy "signed-in read live room state" on public.live_room_state for select to authenticated using (auth.uid() is not null);
drop policy if exists "live mods are public" on public.live_mods;
create policy "signed-in read live mods" on public.live_mods for select to authenticated using (auth.uid() is not null);
drop policy if exists "gta6 badges are public" on public.gta6_badges;
create policy "signed-in read gta6 badges" on public.gta6_badges for select to authenticated using (auth.uid() is not null);

-- youtube cache: server-only writes
drop policy if exists "public can insert YouTube cache" on public.youtube_cache;
drop policy if exists "public can refresh YouTube cache" on public.youtube_cache;
revoke insert, update on public.youtube_cache from anon, authenticated;

-- legacy messages: participants only
drop policy if exists "public read messages" on public.messages;
create policy "participants read messages" on public.messages for select to authenticated
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

-- storage
drop policy if exists "avatars readable" on storage.objects;
create policy "signed-in read avatars" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and auth.uid() is not null);
drop policy if exists "Authenticated users delete video files" on storage.objects;
drop policy if exists "public update videos bucket" on storage.objects;
drop policy if exists "signed-in users update videos bucket" on storage.objects;
create policy "owners update videos bucket" on storage.objects for update to authenticated
  using (bucket_id = 'videos' and owner = auth.uid())
  with check (bucket_id = 'videos' and owner = auth.uid());
