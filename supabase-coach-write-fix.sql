-- ---------------------------------------------------------------------------
-- Run this in the Supabase SQL editor. It fixes one thing, and that one thing
-- is "the coach cannot mark anybody as paid".
--
-- What was wrong. The app writes every record with an upsert — one statement
-- that inserts a row, or updates it if it already exists. Postgres checks the
-- INSERT policy on that statement no matter which of the two it ends up doing.
-- The schema gave the coach SELECT and UPDATE on an athlete's row, and no
-- INSERT. So the moment the coach tried to write to an athlete's record — which
-- is exactly what Mark as Paid does — the whole statement was refused, and the
-- app showed "Couldn't save your last change — check your connection."
--
-- It would not have shown up in testing with athletes the coach created on his
-- own account, because there user_id is the coach's own id and the ordinary
-- "Users manage their own data" policy covers it. It only bites for athletes
-- who signed up themselves, which is every real customer.
--
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

drop policy if exists "Coach inserts their athletes' data" on kv_store;
create policy "Coach inserts their athletes' data"
  on kv_store for insert
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from client_links
      where client_links.client_user_id = kv_store.user_id
        and client_links.coach_user_id = auth.uid()
    )
  );

-- Check it worked. This should list four policies on kv_store: the athlete's
-- own, plus the coach's select, insert and update.
select policyname, cmd
from pg_policies
where tablename = 'kv_store'
order by policyname;
