-- ---------------------------------------------------------------------------
-- Run this in the Supabase SQL editor, AFTER supabase-community-v2.sql and
-- supabase-paid-lock.sql.
--
-- Two things:
--   1. A leaderboard table. It holds only a display name and two numbers per
--      athlete. Everyone signed in can read it, because that is what a
--      leaderboard is; each athlete can write only their own row, and nothing
--      about anyone's training is reachable through it.
--   2. The coach can delete an athlete's data. Until now the coach could read
--      and update an athlete's rows but not remove them, so "delete this
--      client" had to be done by hand in this editor.
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

-- Ranked by weight lifted relative to bodyweight, so a 135 lb athlete and a
-- 220 lb athlete are compared on work done rather than on how big they are.
-- The raw pounds are kept alongside, for display.
create table if not exists leaderboard (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Athlete',
  total_lbs    bigint not null default 0,
  week_lbs     bigint not null default 0,
  bodyweight   numeric,
  total_ratio  numeric not null default 0,
  week_ratio   numeric not null default 0,
  week_start   date,
  updated_at   timestamptz not null default now()
);

-- Existing installs get the new columns.
alter table leaderboard add column if not exists bodyweight  numeric;
alter table leaderboard add column if not exists total_ratio numeric not null default 0;
alter table leaderboard add column if not exists week_ratio  numeric not null default 0;

alter table leaderboard enable row level security;

-- Anyone signed in can see the standings. Name and two numbers, nothing else.
drop policy if exists "Signed-in users read the leaderboard" on leaderboard;
create policy "Signed-in users read the leaderboard"
  on leaderboard for select
  using (auth.uid() is not null);

-- You may publish your own line and nobody else's.
drop policy if exists "Publish your own standing" on leaderboard;
create policy "Publish your own standing"
  on leaderboard for insert
  with check (auth.uid() = user_id);

drop policy if exists "Update your own standing" on leaderboard;
create policy "Update your own standing"
  on leaderboard for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Removing a line is yours, or the coach's when they remove the athlete.
drop policy if exists "Remove your own standing, or a coach removes it" on leaderboard;
create policy "Remove your own standing, or a coach removes it"
  on leaderboard for delete
  using (auth.uid() = user_id or is_community_coach());

create index if not exists leaderboard_total_idx on leaderboard (total_ratio desc);
create index if not exists leaderboard_week_idx on leaderboard (week_start, week_ratio desc);

-- ---------------------------------------------------------------------------
-- The coach can now remove an athlete's data entirely.
-- ---------------------------------------------------------------------------

drop policy if exists "Coach deletes their athletes' data" on kv_store;
create policy "Coach deletes their athletes' data"
  on kv_store for delete
  using (
    auth.uid() = user_id
    or exists (
      select 1 from client_links
      where client_links.client_user_id = kv_store.user_id
        and client_links.coach_user_id = auth.uid()
    )
  );

drop policy if exists "Only a coach removes a link" on client_links;
create policy "Only a coach removes a link"
  on client_links for delete
  using (is_community_coach());

-- Check it worked. Expect a leaderboard table with four policies, a delete
-- policy on kv_store, and a delete policy on client_links.
select policyname, cmd from pg_policies where tablename = 'leaderboard' order by cmd;
select policyname, cmd from pg_policies where tablename = 'kv_store' and cmd = 'DELETE';
select policyname, cmd from pg_policies where tablename = 'client_links' order by cmd;
