-- ---------------------------------------------------------------------------
-- A TEAM GETS EVERY ROOM
--
-- Run AFTER supabase-teams.sql. Safe to run more than once.
--
-- Teams started with three rooms. They now get the same rooms the open side
-- has, one for one, with ids that are the public id behind a "t_".
--
-- The prefix is not cosmetic. The constraint below says a channel starting
-- "t_" must belong to a team and a channel that does not must not — so a
-- private post cannot sit in a public room and a public post cannot sit in a
-- team one, whatever the app asks for. Sharing the ids outright would have
-- left team_id as the only thing between a private post and the open feed,
-- and that is a thing to be sure of rather than careful about.
--
-- Written as a prefix test rather than a list, so adding a room to the app
-- never needs this half of the constraint changed again.
-- ---------------------------------------------------------------------------

-- The three original team rooms move to their equivalents. This runs before
-- the constraints, because a constraint is checked against the rows already
-- in the table.
update community_posts set channel = 't_general'   where channel = 'teamgeneral';
update community_posts set channel = 't_thisweek'  where channel = 'teamweek';
update community_posts set channel = 't_technique' where channel = 'teamclips';

alter table community_posts drop constraint if exists community_posts_team_channel_check;
alter table community_posts
  add constraint community_posts_team_channel_check
  check (
    (team_id is null     and (channel is null or channel not like 't\_%'))
    or (team_id is not null and channel like 't\_%')
  );

-- Every room the app has, open and team. The open names are listed; each team
-- name is the same string with t_ in front of it.
alter table community_posts drop constraint if exists community_posts_channel_check;
alter table community_posts
  add constraint community_posts_channel_check
  check (
    channel in (
      'thisweek',
      'general', 'technique',
      'wrestling', 'footsweeps',
      'passing', 'topcontrol',
      'closedguard', 'halfguard', 'butterfly', 'dlr', 'spider', 'xguard', 'lapel',
      'retention', 'sweeps', 'escapes',
      'back', 'attacktop', 'attackbottom', 'attackside', 'legentries', 'leglocks'
    )
    or channel in (
      't_thisweek',
      't_general', 't_technique',
      't_wrestling', 't_footsweeps',
      't_passing', 't_topcontrol',
      't_closedguard', 't_halfguard', 't_butterfly', 't_dlr', 't_spider', 't_xguard', 't_lapel',
      't_retention', 't_sweeps', 't_escapes',
      't_back', 't_attacktop', 't_attackbottom', 't_attackside', 't_legentries', 't_leglocks'
    )
  );

-- Check: every room holding anything, and whether it belongs to a team.
select channel,
       count(*) filter (where team_id is null)     as open_posts,
       count(*) filter (where team_id is not null) as team_posts
from community_posts
group by channel order by channel;
