-- Run this whole file once, in your Supabase project's SQL Editor
-- (left sidebar -> SQL Editor -> New query -> paste this -> Run).

-- 1) Generic private key-value store: every athlete's data lives here,
--    scoped so each person can only ever see their own rows.
create table if not exists kv_store (
  user_id uuid references auth.users(id) on delete cascade not null,
  key text not null,
  value jsonb not null,
  updated_at timestamptz default now(),
  primary key (user_id, key)
);

alter table kv_store enable row level security;

create policy "Users manage their own data"
  on kv_store for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2) Roster snapshots: REMOVED.
--
--    This backed a "share progress with your coach via a roster code" feature
--    that no longer exists — nothing in the app reads or writes this table. Its
--    policies allowed any signed-in user to read, update and DELETE every row,
--    which was tolerable for an opt-in class-code feature and is not something
--    to leave lying around once the feature is gone.
--
--    On a project that already ran the old version of this file, drop it:
--        drop table if exists roster_snapshots;

-- ---------------------------------------------------------------------------
-- client_links
--
-- Maps each self-signed-up athlete to their coach. Created by hand on the live
-- project before this file caught up; it is written here so a rebuild from
-- scratch produces the same database. Without it the coach dashboard is empty
-- and the Week 2 payment gate can never be lifted.
-- ---------------------------------------------------------------------------
create table if not exists client_links (
  client_user_id uuid primary key references auth.users on delete cascade,
  coach_user_id  uuid not null references auth.users on delete cascade,
  client_email   text,
  created_at     timestamptz not null default now()
);

alter table client_links enable row level security;

-- An athlete may register themselves against their coach, and read that row.
create policy "Athletes create their own link"
  on client_links for insert
  with check (auth.uid() = client_user_id);

create policy "Athlete or coach can read the link"
  on client_links for select
  using (auth.uid() = client_user_id or auth.uid() = coach_user_id);

-- The coach needs to read and update an athlete's row to see their training and
-- to mark them paid. Scoped through client_links so it only ever reaches their
-- own athletes, never every user of the project.
create policy "Coach reads their athletes' data"
  on kv_store for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from client_links
      where client_links.client_user_id = kv_store.user_id
        and client_links.coach_user_id = auth.uid()
    )
  );

create policy "Coach updates their athletes' data"
  on kv_store for update
  using (
    auth.uid() = user_id
    or exists (
      select 1 from client_links
      where client_links.client_user_id = kv_store.user_id
        and client_links.coach_user_id = auth.uid()
    )
  );
