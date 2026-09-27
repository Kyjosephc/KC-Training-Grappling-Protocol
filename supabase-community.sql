-- ---------------------------------------------------------------------------
-- Community feed + clip storage
--
-- This is the first place in this app where people read each other's rows.
-- Everything else is scoped to auth.uid() = the row's owner. Here, every
-- member can read every post, so the policies below are what stands between
-- a private group and an open one. Read them before changing them.
--
-- Membership = you are linked to the coach as an athlete, or you are a coach.
-- Paid status is NOT checked here; see the note at the bottom.
--
-- Paste this whole file into the Supabase SQL editor and run it. It is safe to
-- run more than once: every policy is dropped and recreated rather than added,
-- so a second run updates instead of erroring.
-- ---------------------------------------------------------------------------

create table if not exists community_posts (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references auth.users(id) on delete cascade,
  author_name text not null default 'Member',
  author_belt text,
  body        text,
  video_url   text,
  parent_id   uuid references community_posts(id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- Posts are hidden, never destroyed, so a deletion can be reviewed or undone
  -- and a reply never loses the post it was answering.
  deleted_at  timestamptz,
  deleted_by  uuid
);

create index if not exists community_posts_created_idx on community_posts (created_at desc);
create index if not exists community_posts_parent_idx  on community_posts (parent_id);

create table if not exists community_reactions (
  post_id    uuid not null references community_posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table community_posts     enable row level security;
alter table community_reactions enable row level security;

-- --- posts ----------------------------------------------------------------

drop policy if exists "Members read the feed" on community_posts;
create policy "Members read the feed"
  on community_posts for select
  using (
    exists (select 1 from client_links cl where cl.client_user_id = auth.uid())
    or exists (select 1 from client_links cl where cl.coach_user_id = auth.uid())
  );

drop policy if exists "Members post" on community_posts;
create policy "Members post"
  on community_posts for insert
  with check (
    auth.uid() = author_id
    and (
      exists (select 1 from client_links cl where cl.client_user_id = auth.uid())
      or exists (select 1 from client_links cl where cl.coach_user_id = auth.uid())
    )
  );

-- Authors can hide their own post. The coach can hide anyone's, which is the
-- moderation tool — running a group chat without one is not a position to be in.
-- This is a general update policy, so it also lets an author edit their own
-- wording, and lets the coach edit anyone's. That is a deliberate tradeoff
-- against the extra machinery a hide-only policy would need.
drop policy if exists "Author or coach can hide a post" on community_posts;
create policy "Author or coach can hide a post"
  on community_posts for update
  using (
    auth.uid() = author_id
    or exists (select 1 from client_links cl where cl.coach_user_id = auth.uid())
  )
  with check (
    auth.uid() = author_id
    or exists (select 1 from client_links cl where cl.coach_user_id = auth.uid())
  );

-- --- reactions ------------------------------------------------------------

drop policy if exists "Members read reactions" on community_reactions;
create policy "Members read reactions"
  on community_reactions for select
  using (
    exists (select 1 from client_links cl where cl.client_user_id = auth.uid())
    or exists (select 1 from client_links cl where cl.coach_user_id = auth.uid())
  );

drop policy if exists "Members react" on community_reactions;
create policy "Members react"
  on community_reactions for insert
  with check (
    auth.uid() = user_id
    and (
      exists (select 1 from client_links cl where cl.client_user_id = auth.uid())
      or exists (select 1 from client_links cl where cl.coach_user_id = auth.uid())
    )
  );

drop policy if exists "Members remove their own reaction" on community_reactions;
create policy "Members remove their own reaction"
  on community_reactions for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Clip storage
--
-- So somebody can post a clip they shot on their phone without putting it on
-- YouTube first. The 50 MB ceiling and the video-only mime list are enforced
-- here, on the server, not just in the app: the app's check is a courtesy so
-- the error arrives before a two-minute upload, and this is the real limit.
--
-- READ THIS ONE: the bucket is PUBLIC. The URLs are long and unguessable, and
-- nothing links to them, but anyone who is handed one can watch that clip
-- without signing in -- exactly like an unlisted YouTube video. That is the
-- normal tradeoff for embedding video, and it is the right one for a training
-- group, but the people posting are on camera, so it should be a thing you
-- decided rather than a thing you discovered. The private alternative is
-- signed URLs that expire, which means regenerating one per clip per page
-- load and embeds that break when a link goes stale.
--
-- Storage is billed by what is in the bucket. Hiding a post does not delete
-- its clip, so the bucket only grows. Supabase's free tier is 1 GB; at 50 MB a
-- clip that is about 20 clips before it matters. Delete old ones from the
-- Storage page when it fills.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'community-clips', 'community-clips', true, 52428800,
  array['video/mp4','video/quicktime','video/webm','video/x-m4v']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Uploads go to <your-user-id>/<random>.<ext>, and the first folder has to be
-- your own id. Without that check any member could write into anyone's folder.
drop policy if exists "Members upload their own clips" on storage.objects;
create policy "Members upload their own clips"
  on storage.objects for insert
  with check (
    bucket_id = 'community-clips'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (
      exists (select 1 from client_links cl where cl.client_user_id = auth.uid())
      or exists (select 1 from client_links cl where cl.coach_user_id = auth.uid())
    )
  );

drop policy if exists "Own clips or coach can delete" on storage.objects;
create policy "Own clips or coach can delete"
  on storage.objects for delete
  using (
    bucket_id = 'community-clips'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (select 1 from client_links cl where cl.coach_user_id = auth.uid())
    )
  );

-- No update policy on purpose: a clip is written once and never overwritten.

-- ---------------------------------------------------------------------------
-- On "paid only"
--
-- The app hides the Community tab from anyone not marked paid, but that is a
-- UI decision, not an enforced one: the policies above let any linked athlete
-- read the feed. Hard-enforcing it is not possible while `paid` lives inside
-- the athlete's own kv_store record, because they have write access to that
-- record and could set it themselves.
--
-- To enforce it properly, paid has to live somewhere only the coach can write.
-- The change is: add `paid boolean not null default false` to client_links,
-- have the coach dashboard's paid toggle write there as well, add a coach-only
-- update policy on client_links, and then add `and cl.paid` to the two
-- membership checks above. Worth doing if the feed ever carries something you
-- would mind an unpaid signup seeing.
-- ---------------------------------------------------------------------------
