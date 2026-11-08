-- =============================================================================
-- TWENTY-THREE ROOMS: THE MERGE, PLUS THIS WEEK
-- =============================================================================
-- Run this once in the Supabase SQL editor, BEFORE deploying the new build.
-- Safe to run more than once.
--
-- Fourteen guard rooms became seven. The pairs that came together were one
-- conversation held in two places, and a room nobody posts in reads as a dead
-- app far louder than a missing room reads as a gap. Submissions came out
-- because attacking from top, bottom and side control already cover it and a
-- general room beside them just splits the same posts. Leg locks became two:
-- the entanglements you get to and the finishes you get from them, which are
-- different problems with different answers.
--
-- The UPDATEs run first and they matter. A CHECK constraint is validated
-- against the rows already in the table, so adding the new one while a single
-- post still sits in a retired room would fail the whole migration.
-- =============================================================================

update community_posts set channel = 'halfguard'  where channel in ('kneeshield', 'deephalf');
update community_posts set channel = 'dlr'        where channel = 'rdlr';
update community_posts set channel = 'spider'     where channel = 'lasso';
update community_posts set channel = 'xguard'     where channel = 'slx';
update community_posts set channel = 'lapel'      where channel in ('collarsleeve', 'wormguard');
update community_posts set channel = 'legentries' where channel = 'fiftyfifty';
-- Submissions had no positional information in it, so the catch-all is the
-- only honest destination — anywhere else would be guessing on the athlete's
-- behalf about a post we cannot read.
update community_posts set channel = 'technique'  where channel = 'submissions';

alter table community_posts drop constraint if exists community_posts_channel_check;

alter table community_posts
  add constraint community_posts_channel_check
  check (channel in (
    'thisweek',
    'general', 'technique',
    'wrestling', 'footsweeps',
    'passing', 'topcontrol',
    'closedguard', 'halfguard', 'butterfly', 'dlr', 'spider', 'xguard', 'lapel',
    'retention', 'sweeps', 'escapes',
    'back', 'attacktop', 'attackbottom', 'attackside', 'legentries', 'leglocks'
  ));

create index if not exists community_posts_channel_created_idx
  on community_posts (channel, created_at desc);

-- 'thisweek' is the room for whatever is being drilled in the current week.
-- The app shows only the posts made since the most recent Sunday, so it reads
-- as blank again every week, but nothing in it is ever deleted and the older
-- weeks stay reachable behind "Past weeks". There is no scheduled job here and
-- there should never be one: the clearing is a filter, not a delete.

-- Check: nothing should be left in a retired room, and every row should sit
-- in one of the twenty-three above.
select channel, count(*) from community_posts group by channel order by channel;
