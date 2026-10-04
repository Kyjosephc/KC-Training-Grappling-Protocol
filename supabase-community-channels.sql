-- ---------------------------------------------------------------------------
-- Two channels in the group feed.
--
-- Run this in the Supabase SQL editor after the first two community scripts.
-- Safe to run more than once.
--
-- Everything already posted becomes a General post, which is the right home for
-- it — the feed was general before this existed.
-- ---------------------------------------------------------------------------

alter table community_posts
  add column if not exists channel text not null default 'general';

-- Only the two channels the app knows about. A reply is never given a channel
-- of its own; it inherits its parent's, so a thread can never be split across
-- two tabs.
alter table community_posts drop constraint if exists community_posts_channel_check;
alter table community_posts
  add constraint community_posts_channel_check
  check (channel in ('general', 'technique'));

-- The feed reads one channel at a time, newest first.
create index if not exists community_posts_channel_created_idx
  on community_posts (channel, created_at desc);

-- The guard trigger from the second script lists every column that may not
-- change after a post is written. Channel belongs on that list: moving somebody
-- else's post between channels is an edit, and the only update the app is
-- allowed to make is hiding a post.
create or replace function community_posts_guard() returns trigger
language plpgsql as $$
begin
  if new.id <> old.id
     or new.author_id <> old.author_id
     or new.created_at <> old.created_at
     or new.parent_id is distinct from old.parent_id
     or new.channel is distinct from old.channel
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

-- Check it worked: every existing post should be in general, and the column
-- should refuse anything that is not one of the two channels.
select channel, count(*) from community_posts group by channel;
