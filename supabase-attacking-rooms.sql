-- =============================================================================
-- THREE ATTACKING ROOMS: FROM TOP, FROM BOTTOM, FROM SIDE CONTROL
-- =============================================================================
-- community_posts carries a CHECK constraint naming every room by hand, so a
-- room that exists in the app and not in this constraint refuses every post to
-- it. Run this once in the Supabase SQL editor, BEFORE deploying the new
-- build. Safe to run more than once. Nothing already posted moves.
--
-- Twenty-nine rooms now. The three being added are positional attacking rooms:
-- finishing from on top, finishing off your back, and finishing from side
-- control or from underneath it. Submissions and Leg locks stay as they are —
-- those are rooms about a technique, these are rooms about where you are when
-- you go for it, which is the question most people are actually asking.
-- =============================================================================

alter table community_posts drop constraint if exists community_posts_channel_check;

alter table community_posts
  add constraint community_posts_channel_check
  check (channel in (
    'general', 'technique',
    'wrestling', 'footsweeps',
    'passing', 'topcontrol',
    'closedguard', 'halfguard', 'kneeshield', 'butterfly', 'dlr', 'rdlr',
    'spider', 'lasso', 'xguard', 'slx', 'deephalf', 'fiftyfifty',
    'collarsleeve', 'wormguard',
    'retention', 'sweeps', 'escapes',
    'back', 'attacktop', 'attackbottom', 'attackside', 'submissions', 'leglocks'
  ));

create index if not exists community_posts_channel_created_idx
  on community_posts (channel, created_at desc);

-- Check: every post sits in one of the rooms above. The three new ones will
-- not appear until somebody posts in them.
select channel, count(*) from community_posts group by channel order by channel;
