-- ---------------------------------------------------------------------------
-- Run this in the Supabase SQL editor (Supabase -> SQL Editor -> New query ->
-- paste all of it -> Run). Safe to run more than once.
--
-- Two fixes, both server-side, both invisible in the app until someone goes
-- looking for them.
--
-- 1. THE GROUP WAS READABLE BY ANYONE WHO SIGNED UP.
--    The app hides the Group tab until an athlete is marked paid, but that is a
--    decision made in the browser. On the server, is_community_member() said
--    yes to anybody with a client_links row — and signing up creates one
--    automatically. So a stranger could register on the public site and read
--    every post, name and belt straight off the API without ever paying.
--    After this, reading the Group requires client_links.paid = true, which
--    only the coach can set. Nothing about the app's behaviour changes for
--    anyone who has paid.
--
-- 2. DELETING YOUR OWN POST LEFT EVERYONE ELSE'S REPLIES BEHIND.
--    The app tries to hide the replies along with the post, but row-level
--    security only lets you update rows you wrote. For a thread with replies
--    from other people that statement matched nothing, returned no error, and
--    the app reported success. Those replies stayed in the database, kept
--    counting toward every member's unread badge, and rendered nowhere — so
--    nobody could reach them to remove them, the coach included.
--    A trigger now does the cascade with the database's own rights, so hiding a
--    thread hides the whole thread.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- BEFORE YOU RUN IT: this lists everyone who is linked to you but NOT marked
-- paid. They are already shut out of the Group in the app, so this changes
-- nothing for them — but if someone who has actually paid you is on this list,
-- mark them paid in the Coach Dashboard first.
-- ---------------------------------------------------------------------------
select client_user_id, client_email, paid
  from client_links
 where paid is distinct from true
 order by client_email;

-- 1 ------------------------------------------------------------------------
create or replace function is_community_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
           select 1 from client_links cl
            where cl.client_user_id = auth.uid()
              and cl.paid is true
         )
      or exists (select 1 from community_coaches c where c.user_id = auth.uid());
$$;

-- 2 ------------------------------------------------------------------------
create or replace function cascade_hide_replies() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Only when a root post is being hidden for the first time.
  if new.deleted_at is not null
     and old.deleted_at is null
     and new.parent_id is null then
    update community_posts
       set deleted_at = new.deleted_at,
           deleted_by = new.deleted_by
     where parent_id = new.id
       and deleted_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists cascade_hide_replies_trg on community_posts;
create trigger cascade_hide_replies_trg
  after update on community_posts
  for each row execute function cascade_hide_replies();

-- ---------------------------------------------------------------------------
-- Check it worked. The first should list your paying athletes only; the second
-- should show the trigger.
-- ---------------------------------------------------------------------------
select count(*) as paying_members from client_links where paid is true;
select tgname from pg_trigger where tgname = 'cascade_hide_replies_trg';
