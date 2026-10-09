-- ---------------------------------------------------------------------------
-- Run this in the Supabase SQL editor (SQL Editor -> New query -> paste all of
-- it -> Run). Safe to run more than once.
--
-- Two columns so the Stripe webhook can find an athlete again later. When
-- someone cancels, Stripe tells us the subscription id and nothing else — we
-- need a way to get from that back to the person.
--
-- Nothing here loosens any policy. Athletes still cannot write their own paid
-- flag; the webhook uses the service role key, which bypasses row-level
-- security entirely, and that key lives only on the server.
-- ---------------------------------------------------------------------------

alter table client_links add column if not exists stripe_customer_id text;
alter table client_links add column if not exists stripe_subscription_id text;

create index if not exists client_links_stripe_sub_idx
  on client_links (stripe_subscription_id);

-- The athlete can already read their own row; these two columns ride along with
-- it and tell them nothing they did not already know about themselves.

-- ---------------------------------------------------------------------------
-- Check it worked.
-- ---------------------------------------------------------------------------
select column_name from information_schema.columns
 where table_name = 'client_links' and column_name like 'stripe%';
