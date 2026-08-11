-- Enable Anonymous Sign-Ins in Supabase Auth before deploying the client.
-- Identity is auth.users; SDP/ICE remain ephemeral Realtime Broadcast payloads.
alter table public.online_users drop constraint if exists online_users_id_fkey;
alter table public.online_users
  add constraint online_users_id_fkey foreign key (id) references auth.users(id) on delete cascade not valid;

-- Existing deployments may contain pre-Auth session UUIDs. New and updated
-- rows are checked immediately; validate after those legacy sessions expire.
-- alter table public.online_users validate constraint online_users_id_fkey;
