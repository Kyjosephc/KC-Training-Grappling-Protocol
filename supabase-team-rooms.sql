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
-- community_posts_guard_trg refuses any change to a post's channel: the app
-- may hide a post, never rewrite one. That is right for the app and wrong for
-- a migration whose whole job is to move posts between rooms, so it is turned
-- off for exactly these three statements and turned back on immediately. The
-- editor runs this as one transaction, so a failure anywhere rolls the disable
-- back with everything else — the trigger cannot be left off.
alter table community_posts disable trigger community_posts_guard_trg;

update community_posts set channel = 't_general'   where channel = 'teamgeneral';
update community_posts set channel = 't_thisweek'  where channel = 'teamweek';
update community_posts set channel = 't_technique' where channel = 'teamclips';

alter table community_posts enable trigger community_posts_guard_trg;

alter table community_posts drop constraint if exists community_posts_team_channel_check;
alter table community_posts drop constraint if exists community_posts_channel_check;

-- One line each, because this gets pasted into a web editor by hand and a
-- half-finished paste has to be obvious rather than subtle.
--
-- The shape rule: having a team and having a t_ room are the same question.
-- Either both are true or neither is, so a private post cannot sit in a public
-- room and a public post cannot sit in a team one.
alter table community_posts add constraint community_posts_team_channel_check check ((team_id is null) = (channel not like 't\_%'));

-- Every room spelled out. An earlier version derived the team half with
-- replace(channel, 't_', ''), which is correct for all forty-six ids — and the
-- database rejected a row it should have accepted anyway. Rather than keep
-- arguing with it, the list says what it means. It is longer and it is dull,
-- and neither of those has ever broken anything.
alter table community_posts add constraint community_posts_channel_check check (channel in ('thisweek', 'general', 'technique', 'wrestling', 'footsweeps', 'passing', 'topcontrol', 'closedguard', 'halfguard', 'butterfly', 'dlr', 'spider', 'xguard', 'lapel', 'retention', 'sweeps', 'escapes', 'back', 'attacktop', 'attackbottom', 'attackside', 'legentries', 'leglocks', 't_thisweek', 't_general', 't_technique', 't_wrestling', 't_footsweeps', 't_passing', 't_topcontrol', 't_closedguard', 't_halfguard', 't_butterfly', 't_dlr', 't_spider', 't_xguard', 't_lapel', 't_retention', 't_sweeps', 't_escapes', 't_back', 't_attacktop', 't_attackbottom', 't_attackside', 't_legentries', 't_leglocks'));

select channel,
       count(*) filter (where team_id is null)     as open_posts,
       count(*) filter (where team_id is not null) as team_posts
from community_posts
group by channel order by channel;
