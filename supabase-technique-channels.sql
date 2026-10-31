-- =============================================================================
-- ONE ROOM PER PART OF THE GAME
-- =============================================================================
-- The group had two rooms, General and Technique, and community_posts carries a
-- CHECK constraint naming exactly those two. The app now offers a room for each
-- part of the game, so the constraint has to know about them or every post to a
-- new room is refused by the database.
--
-- Run this once in the Supabase SQL editor, BEFORE deploying the new build.
-- Safe to run more than once.
--
-- Nothing already posted moves. The 'technique' room keeps its id and is now
-- labelled "Everything else" in the app, so every clip already in it is still
-- there and still reachable.
-- =============================================================================

alter table community_posts drop constraint if exists community_posts_channel_check;

alter table community_posts
  add constraint community_posts_channel_check
  check (channel in (
    'general',
    'passing',
    'retention',
    'wrestling',
    'footsweeps',
    'submissions',
    'escapes',
    'leglocks',
    'technique'
  ));

-- The feed reads one room at a time, newest first. This index already exists
-- from the first channels migration; it is repeated here so a database that
-- never ran that one still ends up correct.
create index if not exists community_posts_channel_created_idx
  on community_posts (channel, created_at desc);

-- Check: every row should land in one of the rooms above, and the count under
-- 'technique' is whatever was posted before the split.
select channel, count(*) from community_posts group by channel order by channel;
