-- =============================================================================
-- THE FULL SET OF ROOMS, AND A PRIVATE SAVED LIST
-- =============================================================================
-- Two changes in one file because neither has been run yet. Run this once in
-- the Supabase SQL editor, BEFORE deploying the new build. Safe to run more
-- than once. Nothing already posted moves.
--
-- 1. community_posts carries a CHECK constraint naming every room by hand, so a
--    room that exists in the app and not in this constraint refuses every post
--    to it. The app now has twenty-six.
-- 2. community_saves is new: a private bookmark list, one row per person per
--    post, readable only by the person who made it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Rooms
-- ---------------------------------------------------------------------------
-- 'sweeps' is reversing from the bottom; 'footsweeps' is the standing version.
-- Both labels in the app say which is which, because the names are one word
-- apart and the rooms are not.

alter table community_posts drop constraint if exists community_posts_channel_check;

alter table community_posts
  add constraint community_posts_channel_check
  check (channel in (
    'general', 'technique',
    'wrestling', 'footsweeps',
    'passing', 'topcontrol',
    'closedguard', 'halfguard', 'kneeshield', 'butterfly', 'dlr', 'rdlr',
    'spider', 'lasso', 'xguard', 'slx', 'deephalf', 'fiftyfifty',
    'collarsleeve', 'wormguard',
    'retention', 'sweeps', 'escapes',
    'back', 'submissions', 'leglocks'
  ));

create index if not exists community_posts_channel_created_idx
  on community_posts (channel, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. A private saved list
-- ---------------------------------------------------------------------------
-- The privacy here is the point, and it is the database that enforces it, not
-- the app: there is no policy below that lets anybody read a row they did not
-- write. Not another athlete, and not the coach. A save says something to you,
-- a like says something to the room, and the two are kept apart on purpose.

create table if not exists community_saves (
  user_id    uuid not null references auth.users (id) on delete cascade,
  post_id    uuid not null references community_posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

-- The list is read newest-save-first for one person at a time.
create index if not exists community_saves_user_created_idx
  on community_saves (user_id, created_at desc);

alter table community_saves enable row level security;

drop policy if exists "read your own saves"   on community_saves;
drop policy if exists "save a post"           on community_saves;
drop policy if exists "unsave a post"         on community_saves;

create policy "read your own saves" on community_saves
  for select using (auth.uid() = user_id);

create policy "save a post" on community_saves
  for insert with check (auth.uid() = user_id);

create policy "unsave a post" on community_saves
  for delete using (auth.uid() = user_id);

-- Check 1: every post sits in one of the rooms above.
select channel, count(*) from community_posts group by channel order by channel;

-- Check 2: the saves table exists with row-level security on and three
-- policies, every one of them scoped to auth.uid().
select relrowsecurity as rls_on from pg_class where relname = 'community_saves';
select policyname, cmd from pg_policies
  where tablename = 'community_saves' order by policyname;
