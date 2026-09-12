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
