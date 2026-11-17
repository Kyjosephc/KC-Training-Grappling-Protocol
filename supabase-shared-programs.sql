-- =============================================================================
-- PROGRAMS ATHLETES BUILD AND SHARE
-- =============================================================================
-- Run this once in the Supabase SQL editor, BEFORE deploying the build that
-- adds the Publish button. Safe to run more than once. Nothing existing moves.
--
-- An athlete builds a program on the Build tab, presses Publish, and it waits
-- here until the coach approves it. Only then can anybody else see it, and
-- what they get is a COPY — the program is read once into their own record and
-- never linked back. Somebody in week seven does not want the author's latest
-- edit arriving on a Thursday.
--
-- The app refuses to publish a program that fails its own safety rules before
-- a row ever reaches this table. That check lives in the app because it has to
-- explain itself to the person building; this table is what stops a program
-- reaching anybody before a human has looked at it.
-- =============================================================================

create table if not exists shared_programs (
  id            uuid primary key default gen_random_uuid(),
  author_id     uuid not null references auth.users (id) on delete cascade,
  author_name   text not null,
  title         text not null,
  summary       text not null default '',
  sessions_per_week int  not null,
  weeks         int  not null,
  -- The whole program object, exactly as the app builds it. Stored whole on
  -- purpose: a program is read far more often than it is queried into, and
  -- the shape of a phase is the app's business, not the database's.
  program       jsonb not null,
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected')),
  review_note   text not null default '',
  reviewed_by   uuid references auth.users (id),
  reviewed_at   timestamptz,
  -- Counted rather than derived, because the copy lands in the athlete's own
  -- record and there is nothing left afterwards to count.
  copies        int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists shared_programs_approved_idx
  on shared_programs (status, created_at desc);
create index if not exists shared_programs_author_idx
  on shared_programs (author_id, created_at desc);

alter table shared_programs enable row level security;

-- --- who can see what ------------------------------------------------------
-- Three audiences and they are genuinely different. An athlete sees what the
-- coach has approved, plus their own submissions whatever state those are in,
-- so they can tell the difference between "waiting" and "turned down". The
-- coach sees everything, because deciding on a program means reading it first.

drop policy if exists "read approved programs" on shared_programs;
create policy "read approved programs" on shared_programs
  for select using (status = 'approved');

drop policy if exists "read your own submissions" on shared_programs;
create policy "read your own submissions" on shared_programs
  for select using (auth.uid() = author_id);

drop policy if exists "the coach reads every submission" on shared_programs;
create policy "the coach reads every submission" on shared_programs
  for select using (is_coach());

-- --- publishing ------------------------------------------------------------
-- You may submit your own work and nobody else's, and you may not submit it
-- pre-approved. status is pinned to 'pending' here rather than trusted from
-- the client: the app sends 'pending', and this is what makes that true even
-- if something else ever does the sending.

drop policy if exists "publish your own program" on shared_programs;
create policy "publish your own program" on shared_programs
  for insert with check (auth.uid() = author_id and status = 'pending');

-- --- editing ---------------------------------------------------------------
-- An author can withdraw their own submission, and can keep editing it while
-- it is still waiting. Once it is approved it is frozen to them: people may
-- already be running it, and the copy they took is theirs, but a published
-- program that quietly changes after approval has not been reviewed.

drop policy if exists "withdraw your own submission" on shared_programs;
create policy "withdraw your own submission" on shared_programs
  for delete using (auth.uid() = author_id and status <> 'approved');

drop policy if exists "edit your own submission while it waits" on shared_programs;
create policy "edit your own submission while it waits" on shared_programs
  for update using (auth.uid() = author_id and status = 'pending')
  with check (auth.uid() = author_id and status = 'pending');

-- --- deciding --------------------------------------------------------------
-- The coach is the only one who can move a program out of 'pending', and the
-- only one who can take an approved one back down.

drop policy if exists "the coach decides" on shared_programs;
create policy "the coach decides" on shared_programs
  for update using (is_coach()) with check (is_coach());

drop policy if exists "the coach can remove a program" on shared_programs;
create policy "the coach can remove a program" on shared_programs
  for delete using (is_coach());

-- --- counting copies -------------------------------------------------------
-- An athlete taking a copy has to be able to add one to the tally without
-- being able to touch anything else on the row, which no update policy above
-- allows them to do. A function owned by the definer is the way round that.

create or replace function count_program_copy(p_id uuid)
  returns void
  language sql
  security definer
  set search_path = public
as $$
  update shared_programs
     set copies = copies + 1
   where id = p_id and status = 'approved';
$$;

grant execute on function count_program_copy(uuid) to authenticated;

-- --- what this file does NOT do --------------------------------------------
-- There is no policy letting an athlete read a pending program that is not
-- theirs, and none letting anybody write to another person's row. Both are
-- deliberate. If a future version wants athletes to see what is in the queue,
-- that is a new policy and a new decision, not an oversight here.
