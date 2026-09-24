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

-- 2) Roster snapshots: the opt-in summary a client shares with a coach's
--    roster code (see Settings -> "Share Progress With Your Coach" in the app).
--    Anyone signed in can read or write a snapshot if they know the code,
--    the same trust model as a class code -- treat it like one.
create table if not exists roster_snapshots (
  roster_code text not null,
  client_id text not null,
  snapshot jsonb not null,
  updated_at timestamptz default now(),
  primary key (roster_code, client_id)
);

alter table roster_snapshots enable row level security;

create policy "Signed-in users can read roster snapshots"
  on roster_snapshots for select
  using (auth.role() = 'authenticated');

create policy "Signed-in users can write roster snapshots"
  on roster_snapshots for insert
  with check (auth.role() = 'authenticated');

create policy "Signed-in users can update roster snapshots"
  on roster_snapshots for update
  using (auth.role() = 'authenticated');

create policy "Signed-in users can delete roster snapshots"
  on roster_snapshots for delete
  using (auth.role() = 'authenticated');

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

-- ============================================================================
-- OURA RING CONNECTION
-- ============================================================================
-- Optional: an athlete can link their Oura account so the app reads their sleep
-- and readiness scores instead of asking them to guess at the numbers.
--
-- Both tables below are written ONLY by the serverless functions in api/oura/,
-- using the service role key. They have row-level security on and deliberately
-- no policies at all, so the anon key the browser holds can neither read nor
-- write them. An access token is a password to somebody's health data; it does
-- not belong anywhere the browser can reach.

create table if not exists oura_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  connected_at timestamptz not null default now()
);

alter table oura_connections enable row level security;

-- Short-lived proof that an in-flight OAuth redirect belongs to this account.
-- Rows are deleted the moment they are used, and anything older than ten
-- minutes is rejected on arrival.
create table if not exists oura_oauth_state (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table oura_oauth_state enable row level security;

create index if not exists oura_oauth_state_created_at_idx on oura_oauth_state (created_at);
