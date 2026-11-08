-- ---------------------------------------------------------------------------
-- TEAMS: a private space per gym
--
-- Read this before changing it. Everything that keeps one gym's posts away
-- from another gym is in this file. The app hides what it should not show, but
-- hiding is not privacy — anyone who can open a browser console can ask the
-- database directly, and what comes back is decided here and nowhere else.
--
-- The shape:
--   teams          one row per gym. Only the coach creates them.
--   team_members   one row per person per team, with a status. 'approved' is
--                  the only status that can read anything.
--   community_posts.team_id   null means the open rooms everybody shares.
--                             Not null means it belongs to exactly one team.
--
-- Who can read a team's posts: its approved members, and the coach. The coach
-- can read and hide, but cannot post into a team he is not a member of —
-- moderation is not the same as taking part, and somebody has to be able to
-- act when a post needs removing. The app says this out loud on the team page
-- rather than leaving people to assume otherwise.
--
-- RUN supabase-rooms-v2.sql FIRST. This file rebuilds the channel constraint
-- and its list does not include the rooms that were retired in that migration,
-- so if a post is still sitting in one of them the constraint here cannot be
-- added and the whole run fails. rooms-v2 moves those posts; this follows it.
--
-- Safe to run more than once: tables use "if not exists", every policy is
-- dropped and recreated, and the constraints are dropped before being added.
-- ---------------------------------------------------------------------------

create table if not exists teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- What somebody types to ask to join. Unique, because it is the only way in.
  invite_code text not null unique,
  leader_id   uuid not null references auth.users(id) on delete restrict,
  created_by  uuid not null references auth.users(id) on delete restrict,
  created_at  timestamptz not null default now()
);

create table if not exists team_members (
  team_id      uuid not null references teams(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  member_name  text,
  -- 'pending' can see that it asked and nothing else. 'denied' is kept rather
  -- than deleted so a leader is not asked the same question every week.
  status       text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  role         text not null default 'member' check (role in ('leader', 'member')),
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid,
  primary key (team_id, user_id)
);

create index if not exists team_members_user_idx on team_members (user_id, status);

alter table community_posts add column if not exists team_id uuid references teams(id) on delete cascade;
create index if not exists community_posts_team_idx on community_posts (team_id, channel, created_at desc);

-- The structural half of the guarantee, and the half that does not depend on
-- anybody writing a correct query. A team room cannot hold a post with no team
-- on it, and a public room cannot hold a post that belongs to a team. So a
-- private post cannot land in the open feed even if the app asks it to.
alter table community_posts drop constraint if exists community_posts_team_channel_check;
alter table community_posts
  add constraint community_posts_team_channel_check
  check (
    (team_id is null and (channel is null or channel not in ('teamgeneral', 'teamweek', 'teamclips')))
    or (team_id is not null and channel in ('teamgeneral', 'teamweek', 'teamclips'))
  );

-- The three team rooms have to be allowed by the channel constraint as well.
alter table community_posts drop constraint if exists community_posts_channel_check;
alter table community_posts
  add constraint community_posts_channel_check
  check (channel in (
    'teamgeneral', 'teamweek', 'teamclips',
    'thisweek',
    'general', 'technique',
    'wrestling', 'footsweeps',
    'passing', 'topcontrol',
    'closedguard', 'halfguard', 'butterfly', 'dlr', 'spider', 'xguard', 'lapel',
    'retention', 'sweeps', 'escapes',
    'back', 'attacktop', 'attackbottom', 'attackside', 'legentries', 'leglocks'
  ));

alter table teams        enable row level security;
alter table team_members enable row level security;

-- Asked everywhere below. security definer so that reading team_members from
-- inside a team_members policy does not recurse, and stable so one query does
-- not ask the same question forty times.
create or replace function is_team_member(t uuid)
  returns boolean
  language sql
  security definer
  stable
  set search_path = public
as $$
  select exists (
    select 1 from team_members m
    where m.team_id = t and m.user_id = auth.uid() and m.status = 'approved'
  );
$$;

create or replace function is_team_leader(t uuid)
  returns boolean
  language sql
  security definer
  stable
  set search_path = public
as $$
  select exists (select 1 from teams x where x.id = t and x.leader_id = auth.uid());
$$;

create or replace function is_coach()
  returns boolean
  language sql
  security definer
  stable
  set search_path = public
as $$
  select exists (select 1 from client_links cl where cl.coach_user_id = auth.uid());
$$;

grant execute on function is_team_member(uuid) to authenticated;
grant execute on function is_team_leader(uuid) to authenticated;
grant execute on function is_coach() to authenticated;

-- --- teams ----------------------------------------------------------------

-- A team you belong to, asked to belong to, lead, or created. Deliberately not
-- "every team": a list of every gym using the app, readable by anybody, is the
-- directory the invite code exists to avoid.
drop policy if exists "Your own teams are visible" on teams;
create policy "Your own teams are visible"
  on teams for select
  using (
    leader_id = auth.uid()
    or is_coach()
    or exists (select 1 from team_members m where m.team_id = teams.id and m.user_id = auth.uid())
  );

drop policy if exists "Only the coach starts a team" on teams;
create policy "Only the coach starts a team"
  on teams for insert
  with check (is_coach() and created_by = auth.uid());

drop policy if exists "The leader or the coach edits a team" on teams;
create policy "The leader or the coach edits a team"
  on teams for update
  using (leader_id = auth.uid() or is_coach())
  with check (leader_id = auth.uid() or is_coach());

-- --- team_members ---------------------------------------------------------

drop policy if exists "You see your own membership, a leader sees the team" on team_members;
create policy "You see your own membership, a leader sees the team"
  on team_members for select
  using (user_id = auth.uid() or is_team_leader(team_id) or is_coach());

-- Nobody writes their own membership row directly, which is what stops a
-- person setting their own status to 'approved'. Joining goes through
-- request_team_join below, and deciding goes through the leader.
drop policy if exists "The leader or the coach adds a member" on team_members;
create policy "The leader or the coach adds a member"
  on team_members for insert
  with check (is_team_leader(team_id) or is_coach());

drop policy if exists "The leader or the coach decides" on team_members;
create policy "The leader or the coach decides"
  on team_members for update
  using (is_team_leader(team_id) or is_coach())
  with check (is_team_leader(team_id) or is_coach());

drop policy if exists "Leaving is your own decision" on team_members;
create policy "Leaving is your own decision"
  on team_members for delete
  using (user_id = auth.uid() or is_team_leader(team_id) or is_coach());

-- --- joining by code ------------------------------------------------------

-- The one way in. It runs as the definer so it can find a team by its code
-- without the teams table being readable to somebody who is not in it yet —
-- which is the whole point of a code. It can only ever write a 'pending' row,
-- it never touches an existing approved or denied one, and it tells the caller
-- nothing about the team beyond its name.
create or replace function request_team_join(code text, display_name text)
  returns table (team_id uuid, team_name text, status text)
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  found_id   uuid;
  found_name text;
  existing   text;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select t.id, t.name into found_id, found_name
  from teams t where upper(trim(t.invite_code)) = upper(trim(code));

  if found_id is null then
    raise exception 'no team with that code' using errcode = 'P0002';
  end if;

  select m.status into existing
  from team_members m where m.team_id = found_id and m.user_id = auth.uid();

  if existing is null then
    insert into team_members (team_id, user_id, member_name, status)
    values (found_id, auth.uid(), nullif(trim(display_name), ''), 'pending');
    existing := 'pending';
  elsif existing = 'denied' then
    -- Asking again after a no is allowed; quietly becoming approved is not.
    update team_members m set status = 'pending', requested_at = now(),
           member_name = coalesce(nullif(trim(display_name), ''), m.member_name)
    where m.team_id = found_id and m.user_id = auth.uid();
    existing := 'pending';
  end if;

  team_id := found_id; team_name := found_name; status := existing;
  return next;
end;
$$;

grant execute on function request_team_join(text, text) to authenticated;

-- --- posts ----------------------------------------------------------------

-- The read policy, rewritten. The first half is unchanged — you still have to
-- be in the group at all. The second half is the new line: a post belonging to
-- a team is readable only by that team's approved members, and by the coach.
drop policy if exists "Members read the feed" on community_posts;
create policy "Members read the feed"
  on community_posts for select
  using (
    (
      exists (select 1 from client_links cl where cl.client_user_id = auth.uid())
      or exists (select 1 from client_links cl where cl.coach_user_id = auth.uid())
    )
    and (team_id is null or is_team_member(team_id) or is_coach())
  );

-- Posting into a team requires actually being in it. The coach can read a
-- team's posts and hide one; he cannot write in a room he was not admitted to.
drop policy if exists "Members post" on community_posts;
create policy "Members post"
  on community_posts for insert
  with check (
    auth.uid() = author_id
    and (
      exists (select 1 from client_links cl where cl.client_user_id = auth.uid())
      or exists (select 1 from client_links cl where cl.coach_user_id = auth.uid())
    )
    and (team_id is null or is_team_member(team_id))
  );

-- --- reactions ------------------------------------------------------------

-- A like on a post you are not allowed to read should not be possible either.
-- Without this, somebody holding a post id could still register against it and
-- learn that it exists.
drop policy if exists "Members read reactions" on community_reactions;
create policy "Members read reactions"
  on community_reactions for select
  using (
    exists (
      select 1 from community_posts p
      where p.id = community_reactions.post_id
        and (p.team_id is null or is_team_member(p.team_id) or is_coach())
    )
  );

drop policy if exists "Members react" on community_reactions;
create policy "Members react"
  on community_reactions for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from community_posts p
      where p.id = community_reactions.post_id
        and (p.team_id is null or is_team_member(p.team_id))
    )
  );

-- Check: every team, how many are in it, and how many posts it holds.
select t.name,
       count(distinct m.user_id) filter (where m.status = 'approved') as members,
       count(distinct p.id) as posts
from teams t
left join team_members m on m.team_id = t.id
left join community_posts p on p.team_id = t.id
group by t.name order by t.name;
