-- Upgrade an existing VibeConnect project from users_online to online_users.
drop function if exists public.match_anonymous_user(uuid);

do $$
begin
  if to_regclass('public.users_online') is not null and to_regclass('public.online_users') is null then
    alter table public.users_online rename to online_users;
  end if;
end $$;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'online_users' and column_name = 'communication_type') then
    alter table public.online_users rename column communication_type to communication_mode;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'online_users' and column_name = 'last_seen_at') then
    alter table public.online_users rename column last_seen_at to last_seen;
  end if;
end $$;

alter table public.online_users drop constraint if exists users_online_status_check;
alter table public.online_users drop constraint if exists online_users_status_check;
alter table public.online_users add constraint online_users_status_check check (status in ('searching', 'confirming', 'connected', 'offline'));

-- After the compatibility rename, run supabase/schema.sql to install the new
-- match_proposals table, functions, indexes, and Realtime Presence policies.
