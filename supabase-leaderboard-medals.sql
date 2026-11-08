-- ---------------------------------------------------------------------------
-- WEEKLY MEDALS
--
-- Run this once. Safe to run again.
--
-- One row per athlete per week: how much they moved, relative to bodyweight.
-- Medals are not stored. The top three of each finished week are worked out
-- from these rows whenever the board is opened, so there is no moment when
-- something has to run and no medal that can be missed because nobody had the
-- app open on a Sunday night.
--
-- The same people who can read the board can read this. Each athlete writes
-- only their own rows, which is the same trust model the board already has —
-- the volumes on it have always been self-reported.
-- ---------------------------------------------------------------------------

create table if not exists leaderboard_weeks (
  user_id      uuid not null references auth.users(id) on delete cascade,
  week_start   date not null,
  lbs          integer not null default 0,
  ratio        numeric not null default 0,
  display_name text,
  updated_at   timestamptz not null default now(),
  primary key (user_id, week_start)
);

create index if not exists leaderboard_weeks_week_idx on leaderboard_weeks (week_start desc);

alter table leaderboard_weeks enable row level security;

drop policy if exists "Members read the weeks" on leaderboard_weeks;
create policy "Members read the weeks"
  on leaderboard_weeks for select
  using (
    exists (select 1 from client_links cl where cl.client_user_id = auth.uid())
    or exists (select 1 from client_links cl where cl.coach_user_id = auth.uid())
  );

drop policy if exists "You write your own weeks" on leaderboard_weeks;
create policy "You write your own weeks"
  on leaderboard_weeks for insert with check (auth.uid() = user_id);

drop policy if exists "You update your own weeks" on leaderboard_weeks;
create policy "You update your own weeks"
  on leaderboard_weeks for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "You remove your own weeks" on leaderboard_weeks;
create policy "You remove your own weeks"
  on leaderboard_weeks for delete using (auth.uid() = user_id);

select week_start, count(*) as athletes from leaderboard_weeks group by week_start order by week_start desc;
