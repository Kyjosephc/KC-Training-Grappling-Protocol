-- ---------------------------------------------------------------------------
-- Run this in the Supabase SQL editor (SQL Editor -> New query -> paste all of
-- it -> Run). Safe to run more than once.
--
-- THE COACH COULD NOT CLEAR A REPORT.
-- Reports could be deleted by the person who filed them and nobody else
-- (supabase-community-v2.sql: "Withdraw your own report", delete using
-- auth.uid() = reporter_id). So a post you looked at and judged fine stayed
-- flagged forever, and the new moderation queue in the Group tab would show it
-- every time you opened the app with no way to clear it.
--
-- This adds the coach to that delete policy. Nothing else changes: athletes can
-- still withdraw their own report and still cannot see anyone else's.
-- ---------------------------------------------------------------------------

drop policy if exists "Withdraw your own report" on community_reports;
create policy "Withdraw your own report, or clear it as coach"
  on community_reports for delete
  using (auth.uid() = reporter_id or is_community_coach());

-- ---------------------------------------------------------------------------
-- Check it worked: this should list the new policy.
-- ---------------------------------------------------------------------------
select policyname, cmd from pg_policies
 where tablename = 'community_reports' and cmd = 'DELETE';
