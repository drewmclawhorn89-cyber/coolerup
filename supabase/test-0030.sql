\pset pager off
\echo '--- classifier ---'
select t as text, public.safety_classify(t, 'caption') as kind from (values
  ('check out my new dance'),
  ('send nudes to me'),
  ('I will kill you'),
  ('you are a stupid bitch'),
  ('my password is hunter2'),
  ('follow for follow free followers'),
  ('this analysis of Pakistan is spicy'),
  ('anal'),
  ('repost of someone elses video'),
  ('call me at 555-123-4567')
) v(t);

\echo '--- video trigger: bad caption is hidden ---'
insert into public.profiles (id, handle) values ('22222222-2222-4222-8222-222222222222','baduser');
insert into public.videos (id, user_id, username, caption, video_url)
values ('aaaaaaaa-0000-4000-8000-000000000001','22222222-2222-4222-8222-222222222222','baduser','send nudes','x.mp4');
select id, hidden, hidden_reason, hidden_by from public.videos;

\echo '--- video trigger: clean caption stays visible ---'
insert into public.videos (id, user_id, username, caption, video_url)
values ('aaaaaaaa-0000-4000-8000-000000000002','22222222-2222-4222-8222-222222222222','baduser','my new dance','y.mp4');
select id, hidden from public.videos order by id;

\echo '--- video trigger: repost is exempt ---'
insert into public.videos (id, user_id, username, caption, video_url, source_id)
values ('aaaaaaaa-0000-4000-8000-000000000003','22222222-2222-4222-8222-222222222222','baduser','send nudes','z.mp4','aaaaaaaa-0000-4000-8000-000000000001');
select id, hidden from public.videos where id = 'aaaaaaaa-0000-4000-8000-000000000003';

\echo '--- video trigger: owner is exempt ---'
insert into public.profiles (id, handle) values ('11111111-1111-4111-8111-111111111111','drewmclawhorn3');
insert into public.videos (id, user_id, username, caption, video_url)
values ('aaaaaaaa-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','drewmclawhorn3','send nudes','o.mp4');
select id, hidden from public.videos where id = 'aaaaaaaa-0000-4000-8000-000000000004';

\echo '--- comment trigger: bad comment is cancelled ---'
insert into public.comments (id, video_id, username, body)
values ('bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000002','baduser','kys loser');
select count(*) as comments_after_bad from public.comments;

insert into public.comments (id, video_id, username, body)
values ('bbbbbbbb-0000-4000-8000-000000000002','aaaaaaaa-0000-4000-8000-000000000002','baduser','love this');
select count(*) as comments_after_clean from public.comments;

\echo '--- message trigger ---'
insert into public.messages (sender_id, receiver_id, message)
values ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','my password is abc123');
select count(*) as messages_after_bad from public.messages;

\echo '--- profile trigger ---'
update public.profiles set bio = 'I am Coolerup support, dm me' where id = '22222222-2222-4222-8222-222222222222';
select handle, bio, display_name from public.profiles where id = '22222222-2222-4222-8222-222222222222';

\echo '--- log rows ---'
select action, kind, content_type, username, left(content_excerpt, 40) as excerpt from public.moderation_log order by created_at;

\echo '--- sweep ---'
select public.safety_bot_sweep();

\echo '--- sweep finds content that predates the trigger ---'
alter table public.videos disable trigger videos_safety_guard;
insert into public.videos (id, user_id, username, caption, video_url)
values ('aaaaaaaa-0000-4000-8000-00000000000a','22222222-2222-4222-8222-222222222222','baduser','watch my porn video','old.mp4');
alter table public.videos enable trigger videos_safety_guard;
select id, hidden from public.videos where id = 'aaaaaaaa-0000-4000-8000-00000000000a';
select public.safety_bot_sweep() as sweep;
select id, hidden, hidden_reason from public.videos where id = 'aaaaaaaa-0000-4000-8000-00000000000a';

\echo '--- purge removes hidden rows ---'
select public.purge_hidden_videos() as purge;
select count(*) as hidden_left from public.videos where hidden = true;
