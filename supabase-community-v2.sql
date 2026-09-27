-- ---------------------------------------------------------------------------
-- Community: security fixes and moderation
--
-- Run this in the Supabase SQL editor after the first community script.
-- It is safe to run more than once.
--
-- What it fixes:
--   1. Anyone who signed up could make themselves a moderator of the feed.
--   2. Someone whose post was removed could put it back.
--   3. A post's text, author and timestamp could be rewritten after the fact.
--   4. There was no way to stop one person posting.
--   5. There was no way for a member to report a post.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Who counts as the coach
--
-- The old policies asked "does any row name me as a coach?" — one column, and
-- nothing stopped a new signup inserting a row naming themselves. That made
-- them a moderator: able to hide or rewrite anyone's post and delete anyone's
-- video. This table is the answer instead, and nothing can write to it through
-- the API: there is no insert, update or delete policy, on purpose. To add a
-- coach later, come back to this SQL editor.
-- ---------------------------------------------------------------------------

create table if not exists community_coaches (
  user_id uuid primary key references auth.users(id) on delete cascade
);

alter table community_coaches enable row level security;

drop policy if exists "Signed-in users can read the coach list" on community_coaches;
create policy "Signed-in users can read the coach list"
  on community_coaches for select
  using (auth.uid() is not null);

-- Seeded from who is already coaching somebody. Self-referential rows are
-- excluded, since those are exactly the rows the old hole would have created.
insert into community_coaches (user_id)
select distinct coach_user_id
from client_links
where coach_user_id is not null
  and coach_user_id <> client_user_id
on conflict (user_id) do nothing;

-- And close the door behind us, so no new self-appointed link can be made.
drop policy if exists "Athletes create their own link" on client_links;
create policy "Athletes create their own link"
  on client_links for insert
  with check (auth.uid() = client_user_id and coach_user_id <> client_user_id);

create or replace function is_community_coach() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from community_coaches c where c.user_id = auth.uid());
$$;

create or replace function is_community_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from client_links cl where cl.client_user_id = auth.uid())
      or exists (select 1 from community_coaches c where c.user_id = auth.uid());
$$;


-- ---------------------------------------------------------------------------
-- 2. Blocking
--
-- Removing posts one at a time was the only answer to someone behaving badly.
-- A blocked member can still read the group; they just can't post. Only a coach
-- can add or remove one, and everyone can read the list so the app can tell a
-- blocked member plainly rather than letting them write a post that is refused.
-- ---------------------------------------------------------------------------

create table if not exists community_blocks (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  user_name  text,
  blocked_at timestamptz not null default now()
);

alter table community_blocks enable row level security;

drop policy if exists "Members read the block list" on community_blocks;
create policy "Members read the block list"
  on community_blocks for select using (is_community_member());

drop policy if exists "Only a coach blocks" on community_blocks;
create policy "Only a coach blocks"
  on community_blocks for insert with check (is_community_coach());

drop policy if exists "Only a coach updates a block" on community_blocks;
create policy "Only a coach updates a block"
  on community_blocks for update using (is_community_coach()) with check (is_community_coach());

drop policy if exists "Only a coach unblocks" on community_blocks;
create policy "Only a coach unblocks"
  on community_blocks for delete using (is_community_coach());


-- ---------------------------------------------------------------------------
-- 3. Reporting
--
-- So somebody who sees something upsetting has an option other than leaving
-- the group. Members can report and can see what they themselves reported; only
-- a coach sees everyone's.
-- ---------------------------------------------------------------------------

create table if not exists community_reports (
  post_id     uuid not null references community_posts(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (post_id, reporter_id)
);

alter table community_reports enable row level security;

drop policy if exists "See your own reports, or all of them as coach" on community_reports;
create policy "See your own reports, or all of them as coach"
  on community_reports for select
  using (auth.uid() = reporter_id or is_community_coach());

drop policy if exists "Members report" on community_reports;
create policy "Members report"
  on community_reports for insert
  with check (auth.uid() = reporter_id and is_community_member());

drop policy if exists "Withdraw your own report" on community_reports;
create policy "Withdraw your own report"
  on community_reports for delete using (auth.uid() = reporter_id);


-- ---------------------------------------------------------------------------
-- 4. An update may only ever hide a post
--
-- The old policy allowed any update to a row you owned. That meant the author
-- of a post the coach had removed could set deleted_at back to null and put it
-- back, and anyone could rewrite their own post's text, author or timestamp
-- after people had read it. A post dated in the year 2099 also pinned itself to
-- the top of the feed and jammed every member's unread badge permanently.
--
-- Row-level policies can't restrict which columns change, so this does.
-- ---------------------------------------------------------------------------

create or replace function community_posts_guard() returns trigger
language plpgsql as $$
begin
  if new.id <> old.id
     or new.author_id <> old.author_id
     or new.created_at <> old.created_at
     or new.parent_id is distinct from old.parent_id
     or new.body is distinct from old.body
     or new.video_url is distinct from old.video_url
     or new.author_name is distinct from old.author_name
     or new.author_belt is distinct from old.author_belt then
    raise exception 'a post can only be hidden, not edited';
  end if;
  if old.deleted_at is not null and new.deleted_at is null then
    raise exception 'a removed post cannot be restored from the app';
  end if;
  return new;
end $$;

drop trigger if exists community_posts_guard_trg on community_posts;
create trigger community_posts_guard_trg
  before update on community_posts
  for each row execute function community_posts_guard();


-- ---------------------------------------------------------------------------
-- 5. Rewrite the original policies to use the checks above
-- ---------------------------------------------------------------------------

drop policy if exists "Members read the feed" on community_posts;
create policy "Members read the feed"
  on community_posts for select using (is_community_member());

-- Blocked members can read but not write.
drop policy if exists "Members post" on community_posts;
create policy "Members post"
  on community_posts for insert
  with check (
    auth.uid() = author_id
    and is_community_member()
    and not exists (select 1 from community_blocks b where b.user_id = auth.uid())
  );

drop policy if exists "Author or coach can hide a post" on community_posts;
create policy "Author or coach can hide a post"
  on community_posts for update
  using (auth.uid() = author_id or is_community_coach())
  with check (auth.uid() = author_id or is_community_coach());

drop policy if exists "Members read reactions" on community_reactions;
create policy "Members read reactions"
  on community_reactions for select using (is_community_member());

drop policy if exists "Members react" on community_reactions;
create policy "Members react"
  on community_reactions for insert
  with check (auth.uid() = user_id and is_community_member());

-- Re-hearting sends an upsert, which Postgres treats as insert-or-update and
-- which needs an update policy to exist at all. Without this a second heart on
-- the same post silently failed and retried three times.
drop policy if exists "Members re-react" on community_reactions;
create policy "Members re-react"
  on community_reactions for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Members remove their own reaction" on community_reactions;
create policy "Members remove their own reaction"
  on community_reactions for delete using (auth.uid() = user_id);

drop policy if exists "Members upload their own clips" on storage.objects;
create policy "Members upload their own clips"
  on storage.objects for insert
  with check (
    bucket_id = 'community-clips'
    and (storage.foldername(name))[1] = auth.uid()::text
    and is_community_member()
    and not exists (select 1 from community_blocks b where b.user_id = auth.uid())
  );

drop policy if exists "Own clips or coach can delete" on storage.objects;
create policy "Own clips or coach can delete"
  on storage.objects for delete
  using (
    bucket_id = 'community-clips'
    and ((storage.foldername(name))[1] = auth.uid()::text or is_community_coach())
  );


-- ---------------------------------------------------------------------------
-- Check the result. This should list exactly one row — you.
-- If it lists anyone else, or nobody, stop and sort that out before anything
-- else: this table is who can moderate the feed.
-- ---------------------------------------------------------------------------

select c.user_id, u.email
from community_coaches c
join auth.users u on u.id = c.user_id;
