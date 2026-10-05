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
-- A second, older INSERT policy existed on the live project under a different
-- name. Postgres ORs policies together, so leaving it in place would have let a
-- signup set paid = true straight past the rule below.
drop policy if exists "clients can create their own link" on client_links;

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

-- Check it worked. Expect: a paid column, an insert policy that mentions paid,
-- and an update policy named "Only a coach updates a link".
-- Expect exactly three rows: one INSERT whose with_check mentions paid = false,
-- one SELECT, and one UPDATE guarded by is_community_coach().
select policyname, cmd, with_check from pg_policies
  where tablename = 'client_links' order by cmd;
