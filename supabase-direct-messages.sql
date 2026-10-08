-- ---------------------------------------------------------------------------
-- Direct messages. Run AFTER supabase-community-v2.sql and
-- supabase-leaderboard-and-admin.sql.
--
-- One table. A message is readable only by the two people in it, and the coach
-- cannot read anyone's DMs — that is deliberate. Finding somebody to message
-- uses the leaderboard table, which already holds a display name per athlete
-- and is already readable by signed-in members, so nothing new is exposed.
-- ---------------------------------------------------------------------------

create table if not exists direct_messages (
  id           uuid primary key,
  sender_id    uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  sender_name  text not null default 'Athlete',
  body         text not null default '',
  link_url     text,
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  deleted_at   timestamptz,
  constraint dm_not_self check (sender_id <> recipient_id),
  constraint dm_has_content check (length(coalesce(body,'')) > 0 or length(coalesce(link_url,'')) > 0),
  constraint dm_body_len check (length(coalesce(body,'')) <= 2000)
);

alter table direct_messages enable row level security;

create index if not exists dm_pair_idx on direct_messages (sender_id, recipient_id, created_at desc);
create index if not exists dm_inbox_idx on direct_messages (recipient_id, created_at desc);

-- You can read a message only if you sent it or it was sent to you.
drop policy if exists "Read your own conversations" on direct_messages;
create policy "Read your own conversations"
  on direct_messages for select
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

-- You can only send as yourself, and only to somebody who has an account.
drop policy if exists "Send as yourself" on direct_messages;
create policy "Send as yourself"
  on direct_messages for insert
  with check (auth.uid() = sender_id and sender_id <> recipient_id);

-- The recipient marks a message read; the sender can withdraw one they sent.
drop policy if exists "Mark read or withdraw" on direct_messages;
create policy "Mark read or withdraw"
  on direct_messages for update
  using (auth.uid() = recipient_id or auth.uid() = sender_id)
  with check (auth.uid() = recipient_id or auth.uid() = sender_id);

drop policy if exists "Delete your own message" on direct_messages;
create policy "Delete your own message"
  on direct_messages for delete
  using (auth.uid() = sender_id);

-- Check it worked: expect four policies — SELECT, INSERT, UPDATE, DELETE.
select policyname, cmd from pg_policies where tablename = 'direct_messages' order by cmd;
