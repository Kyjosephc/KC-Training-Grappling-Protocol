-- =============================================================================
-- PRIVACY AND ACCOUNT DELETION
-- =============================================================================
-- Run this once in the Supabase SQL editor. It does two things the app cannot
-- do for itself, because both are permissions rather than code.
--
-- Safe to run more than once.
-- =============================================================================


-- 1. The leaderboard no longer stores anybody's bodyweight -------------------
--
-- The board ranks on work done relative to bodyweight, and that ratio is
-- computed in the app before it publishes. The weight itself was being stored
-- alongside it and selected by every member on every load, so each athlete was
-- downloading everybody else's bodyweight for a number no screen ever showed.
-- The app has stopped sending it and stopped asking for it; this removes the
-- column so it cannot be read back by anyone who asks the API directly.

alter table if exists leaderboard drop column if exists bodyweight;


-- 2. An athlete can delete their own posts ----------------------------------
--
-- There was no delete policy on community_posts at all, for anybody. Posts
-- could only be stamped deleted_at, which takes them out of every feed but
-- leaves the row and its text in the database for ever. That is fine for
-- moderation and not good enough for "delete my account", so an author can now
-- delete their own posts outright, and the coach can delete anything — which is
-- also what makes a report actionable rather than merely hideable.
--
-- Until this policy exists the app falls back to stamping the posts deleted,
-- so account deletion works either way; this is what makes it a real delete.

drop policy if exists "Author or coach can delete a post" on community_posts;
create policy "Author or coach can delete a post"
  on community_posts for delete
  using (
    auth.uid() = author_id
    or exists (select 1 from client_links cl where cl.coach_user_id = auth.uid())
  );


-- 3. Reactions on a deleted post go with it ---------------------------------
--
-- community_reactions.post_id references community_posts(id). Confirm the
-- cascade so deleting a post cannot fail on a foreign key from somebody else's
-- reaction to it.

do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'community_reactions_post_id_fkey'
      and table_name = 'community_reactions'
  ) then
    alter table community_reactions drop constraint community_reactions_post_id_fkey;
  end if;
  alter table community_reactions
    add constraint community_reactions_post_id_fkey
    foreign key (post_id) references community_posts(id) on delete cascade;
exception when others then
  raise notice 'community_reactions cascade left as it was: %', sqlerrm;
end $$;


-- 4. Reports on a deleted post go with it -----------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'community_reports_post_id_fkey'
      and table_name = 'community_reports'
  ) then
    alter table community_reports drop constraint community_reports_post_id_fkey;
  end if;
  alter table community_reports
    add constraint community_reports_post_id_fkey
    foreign key (post_id) references community_posts(id) on delete cascade;
exception when others then
  raise notice 'community_reports cascade left as it was: %', sqlerrm;
end $$;


-- What this still does not do -----------------------------------------------
--
-- It does not delete the login itself. Removing a row from auth.users needs the
-- service role key, which must never be in a browser bundle, so an athlete who
-- deletes their account and then signs in again lands on a fresh signup with
-- nothing attached to it. Deleting the login as well needs an Edge Function
-- holding that key — worth doing, and a separate job from this file.
