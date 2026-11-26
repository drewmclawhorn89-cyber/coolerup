-- ===========================================================================
-- 20261229000000 · RESTORE EVERYTHING THAT WAS TAKEN DOWN
--
-- Puts back every video, comment, message and account that moderation took
-- down for ANY reason: auto ban, AI bot, reports, or a manual delete.
--
-- There is no button and no new page. This runs by itself:
--   1. this migration restores everything immediately, once, when Lovable
--      applies it;
--   2. `restore_all_taken_down_content()` is called again from the app shell
--      on load (src/lib/restoreContent.ts) so anything taken down later comes
--      back too.
--
-- Four parts:
--   1. Add the soft-delete / ban columns the restore writes to (if missing).
--   2. `deleted_content` archive so hard deletes become recoverable.
--   3. `restore_all_taken_down_content()` — the restore itself.
--   4. Run it once.
--
-- NOTE ON HARD DELETES: before this migration, Admin > Reports "delete" did a
-- real `delete from public.videos/comments`. Those rows are gone and no SQL
-- can bring them back. From now on the same button archives the row first, so
-- the restore can put it back.
-- ===========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Columns the restore writes to
-- ---------------------------------------------------------------------------
-- `add column if not exists` is a no-op on projects that already have them.

do $$
begin
  if to_regclass('public.videos') is not null then
    alter table public.videos add column if not exists is_deleted boolean not null default false;
    alter table public.videos add column if not exists is_hidden boolean not null default false;
    alter table public.videos add column if not exists status text not null default 'active';
    alter table public.videos add column if not exists deleted_at timestamptz;
  end if;

  if to_regclass('public.full_videos') is not null then
    alter table public.full_videos add column if not exists is_deleted boolean not null default false;
    alter table public.full_videos add column if not exists is_hidden boolean not null default false;
    alter table public.full_videos add column if not exists deleted_at timestamptz;
  end if;

  if to_regclass('public.comments') is not null then
    alter table public.comments add column if not exists is_deleted boolean not null default false;
    alter table public.comments add column if not exists status text not null default 'active';
  end if;

  if to_regclass('public.full_video_comments') is not null then
    alter table public.full_video_comments add column if not exists is_deleted boolean not null default false;
    alter table public.full_video_comments add column if not exists status text not null default 'active';
  end if;

  if to_regclass('public.group_post_comments') is not null then
    alter table public.group_post_comments add column if not exists is_deleted boolean not null default false;
    alter table public.group_post_comments add column if not exists status text not null default 'active';
  end if;

  if to_regclass('public.group_posts') is not null then
    alter table public.group_posts add column if not exists is_deleted boolean not null default false;
    alter table public.group_posts add column if not exists status text not null default 'active';
  end if;

  if to_regclass('public.messages') is not null then
    alter table public.messages add column if not exists is_deleted boolean not null default false;
  end if;

  if to_regclass('public.direct_messages') is not null then
    alter table public.direct_messages add column if not exists is_deleted boolean not null default false;
  end if;

  if to_regclass('public.profiles') is not null then
    alter table public.profiles add column if not exists is_banned boolean not null default false;
    alter table public.profiles add column if not exists is_muted boolean not null default false;
    alter table public.profiles add column if not exists warning_count integer not null default 0;
    alter table public.profiles add column if not exists ban_reason text;
    alter table public.profiles add column if not exists mute_until timestamptz;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Archive of hard-deleted rows
-- ---------------------------------------------------------------------------
-- The whole row is kept as jsonb so the archive never drifts out of sync with
-- the table it came from. Only security-definer code touches this table.
create table if not exists public.deleted_content (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  row_id uuid,
  row_data jsonb not null,
  deleted_at timestamptz not null default now(),
  deleted_by text,
  reason text
);

create index if not exists deleted_content_table_idx
  on public.deleted_content (table_name, deleted_at desc);

alter table public.deleted_content enable row level security;

-- ---------------------------------------------------------------------------
-- 3. The restore
-- ---------------------------------------------------------------------------
create or replace function public.restore_all_taken_down_content()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  restored_rows integer := 0;
  videos_back integer := 0;
  comments_back integer := 0;
  messages_back integer := 0;
  users_back integer := 0;
  archived_back integer := 0;
begin
  -- ---- 3a. Put archived (hard-deleted) rows back ------------------------
  if to_regclass('public.deleted_content') is not null then
    for rec in
      select *
      from public.deleted_content
      where table_name in (
        'videos', 'full_videos', 'comments', 'full_video_comments',
        'group_posts', 'group_post_comments', 'messages', 'direct_messages'
      )
      order by deleted_at asc
    loop
      begin
        if to_regclass('public.' || rec.table_name) is null then
          continue;
        end if;
        execute format(
          'insert into public.%I select * from jsonb_populate_record(null::public.%I, $1) on conflict (id) do nothing',
          rec.table_name, rec.table_name
        ) using rec.row_data;
        get diagnostics restored_rows = row_count;
        archived_back := archived_back + restored_rows;
        delete from public.deleted_content where id = rec.id;
      exception when others then
        -- Leave it in the archive and keep going; one bad row must not stop
        -- the rest of the restore.
        null;
      end;
    end loop;
  end if;

  -- ---- 3b. Videos -------------------------------------------------------
  if to_regclass('public.videos') is not null then
    update public.videos
       set hidden = false,
           hidden_reason = null,
           is_hidden = false,
           is_deleted = false,
           status = 'active',
           deleted_at = null
     where hidden is distinct from false
        or hidden_reason is not null
        or is_hidden
        or is_deleted
        or status is distinct from 'active'
        or deleted_at is not null;
    get diagnostics videos_back = row_count;
  end if;

  if to_regclass('public.full_videos') is not null then
    -- `full_videos` is visible when status is 'ready' (or null), so that is
    -- the "active" value for this table.
    update public.full_videos
       set status = 'ready',
           is_hidden = false,
           is_deleted = false,
           deleted_at = null
     where status is distinct from 'ready'
        or is_hidden
        or is_deleted
        or deleted_at is not null;
    get diagnostics restored_rows = row_count;
    videos_back := videos_back + restored_rows;
  end if;

  -- ---- 3c. Comments -----------------------------------------------------
  if to_regclass('public.comments') is not null then
    update public.comments
       set is_deleted = false,
           status = 'active'
     where is_deleted
        or status is distinct from 'active';
    get diagnostics comments_back = row_count;
  end if;

  if to_regclass('public.full_video_comments') is not null then
    update public.full_video_comments
       set is_deleted = false,
           status = 'active'
     where is_deleted
        or status is distinct from 'active';
    get diagnostics restored_rows = row_count;
    comments_back := comments_back + restored_rows;
  end if;

  if to_regclass('public.group_post_comments') is not null then
    update public.group_post_comments
       set is_deleted = false,
           status = 'active'
     where is_deleted
        or status is distinct from 'active';
    get diagnostics restored_rows = row_count;
    comments_back := comments_back + restored_rows;
  end if;

  if to_regclass('public.group_posts') is not null then
    update public.group_posts
       set is_deleted = false,
           status = 'active'
     where is_deleted
        or status is distinct from 'active';
    get diagnostics restored_rows = row_count;
    comments_back := comments_back + restored_rows;
  end if;

  -- ---- 3d. Messages -----------------------------------------------------
  if to_regclass('public.messages') is not null then
    update public.messages
       set is_deleted = false
     where is_deleted;
    get diagnostics messages_back = row_count;
  end if;

  if to_regclass('public.direct_messages') is not null then
    update public.direct_messages
       set is_deleted = false
     where is_deleted;
    get diagnostics restored_rows = row_count;
    messages_back := messages_back + restored_rows;
  end if;

  -- ---- 3e. Accounts -----------------------------------------------------
  -- Clear the ban/mute/warning columns on every profile...
  if to_regclass('public.profiles') is not null then
    update public.profiles
       set is_banned = false,
           is_muted = false,
           warning_count = 0,
           ban_reason = null,
           mute_until = null
     where is_banned
        or is_muted
        or warning_count <> 0
        or ban_reason is not null
        or mute_until is not null;
    get diagnostics users_back = row_count;
  end if;

  -- ...then remove the ban records themselves, so nothing re-hides the
  -- content through the `account_is_banned()` policies or the ban trigger.
  if to_regclass('public.banned_users') is not null then
    delete from public.banned_users;
    get diagnostics restored_rows = row_count;
    users_back := users_back + restored_rows;
  end if;

  if to_regclass('public.user_strikes') is not null then
    delete from public.user_strikes;
  end if;

  -- Device / identity bans blocked new signups; they go too.
  if to_regclass('public.identity_bans') is not null then
    delete from public.identity_bans;
  end if;

  if to_regclass('public.user_devices') is not null then
    delete from public.user_devices;
  end if;

  -- ---- 3f. Anything still flagged as "author banned" --------------------
  if to_regclass('public.videos') is not null then
    update public.videos
       set hidden = false,
           hidden_reason = null,
           is_hidden = false
     where hidden
       and (hidden_reason is null or hidden_reason ilike '%ban%');
  end if;

  return jsonb_build_object(
    'ok', true,
    'videos_restored', videos_back,
    'comments_restored', comments_back,
    'messages_restored', messages_back,
    'users_restored', users_back,
    'archived_rows_restored', archived_back
  );
end;
$$;

-- The app shell calls this on load, before sign-in has necessarily resolved,
-- so anon needs it too.
revoke all on function public.restore_all_taken_down_content() from public;
grant execute on function public.restore_all_taken_down_content() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Restore everything right now
-- ---------------------------------------------------------------------------
select public.restore_all_taken_down_content();

notify pgrst, 'reload schema';
