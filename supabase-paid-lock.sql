-- ---------------------------------------------------------------------------
-- Run this in the Supabase SQL editor. It moves one thing — whether an athlete
-- has paid — out of the athlete's own record and into a column only the coach
-- can write.
--
-- Why it matters. Every athlete's training record lives in kv_store, and the
-- policy that makes the app work gives each person full control of their own
-- row: "Users manage their own data", for all, using auth.uid() = user_id.
-- The paid flag lived inside that row. The Mark as Paid button was the coach's
-- alone, but the flag underneath it was not — an athlete could set it on
-- themselves with one API call, without ever opening the dashboard.
--
-- After this, paid lives on client_links. The athlete can read their own row
-- and nothing more. Only the coach can change it, and the insert policy makes
-- it impossible to sign up already paid.
--
-- Safe to run more than once. Run supabase-community-v2.sql first if you have
-- not already — this builds on the coach list it creates.
-- ---------------------------------------------------------------------------

alter table client_links add column if not exists paid boolean not null default false;

-- Carry across anyone already marked paid in their own record, so nobody who
-- has already paid you gets asked twice.
update client_links cl
set paid = true
from kv_store kv
where kv.user_id = cl.client_user_id
  and kv.key like 'sc-app:client:%'
  and coalesce((kv.value ->> 'paid')::boolean, false) = true
  and cl.paid = false;

-- Signing up already paid is not possible: a new row must come in false.
drop policy if exists "Athletes create their own link" on client_links;
create policy "Athletes create their own link"
  on client_links for insert
  with check (
    auth.uid() = client_user_id
    and coach_user_id <> client_user_id
    and paid = false
  );

-- Only a coach may change this row, and the only thing worth changing is paid.
drop policy if exists "Only a coach updates a link" on client_links;
create policy "Only a coach updates a link"
  on client_links for update
  using (is_community_coach())
  with check (is_community_coach());

-- Belt and braces: even a coach cannot repoint a link at a different athlete,
-- and nobody can hand themselves a different coach.
create or replace function client_links_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.client_user_id is distinct from old.client_user_id
     or new.coach_user_id is distinct from old.coach_user_id then
    raise exception 'client_links: only paid may change';
  end if;
  return new;
end;
$$;
drop trigger if exists client_links_guard_trg on client_links;
create trigger client_links_guard_trg
  before update on client_links
  for each row execute function client_links_guard();

-- Check it worked. Expect: a paid column, an insert policy that mentions paid,
-- and an update policy named "Only a coach updates a link".
select column_name, data_type from information_schema.columns
  where table_name = 'client_links' and column_name = 'paid';
select policyname, cmd from pg_policies
  where tablename = 'client_links' order by cmd, policyname;
select count(*) filter (where paid) as marked_paid, count(*) as total from client_links;
