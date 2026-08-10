-- VibeConnect production schema for Supabase PostgreSQL.
-- Run in a new Supabase project, then enable Realtime for public.messages.

create extension if not exists pgcrypto;

create table if not exists public.users_online (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique,
  session_token_hash text not null unique,
  username text not null check (username ~ '^[A-Za-z0-9_-]{3,20}$'),
  gender text not null check (gender in ('male', 'female', 'other', 'prefer_not_to_say')),
  communication_type text not null check (communication_type in ('text', 'voice', 'video')),
  interests jsonb not null default '[]'::jsonb check (jsonb_typeof(interests) = 'array'),
  age_group text,
  status text not null default 'searching' check (status in ('searching', 'connected', 'offline')),
  socket_id text,
  warning_count integer not null default 0 check (warning_count >= 0),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  user1_id uuid not null references public.users_online(id) on delete cascade,
  user2_id uuid not null references public.users_online(id) on delete cascade,
  mode text not null check (mode in ('text', 'voice', 'video')),
  status text not null default 'active' check (status in ('active', 'ended')),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  check (user1_id <> user2_id)
);

create table if not exists public.room_members (
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  user_id uuid not null references public.users_online(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  sender_id uuid not null references public.users_online(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 1000),
  created_at timestamptz not null default now(),
  seen_at timestamptz
);

create table if not exists public.blocks (
  blocker_id uuid not null references public.users_online(id) on delete cascade,
  blocked_id uuid not null references public.users_online(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.chat_rooms(id) on delete set null,
  reporter_id uuid not null references public.users_online(id) on delete cascade,
  reported_id uuid not null references public.users_online(id) on delete cascade,
  reason text not null check (reason in ('harassment', 'hate_speech', 'sexual_content', 'spam', 'threats')),
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (reporter_id <> reported_id)
);

create table if not exists public.banned_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users_online(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.moderation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users_online(id) on delete cascade,
  room_id uuid references public.chat_rooms(id) on delete set null,
  source text not null check (source in ('openai', 'local')),
  categories jsonb not null default '[]'::jsonb,
  scores jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.rate_limit_buckets (
  bucket_key text primary key,
  hit_count integer not null default 0,
  window_started_at timestamptz not null default now()
);

create index if not exists users_online_match_queue_idx
  on public.users_online (communication_type, status, created_at)
  where status = 'searching';
create index if not exists users_online_last_seen_idx on public.users_online (last_seen_at);
create index if not exists chat_rooms_user1_recent_idx on public.chat_rooms (user1_id, created_at desc);
create index if not exists chat_rooms_user2_recent_idx on public.chat_rooms (user2_id, created_at desc);
create index if not exists room_members_user_idx on public.room_members (user_id, room_id);
create index if not exists messages_room_time_idx on public.messages (room_id, created_at);
create index if not exists reports_status_time_idx on public.reports (status, created_at desc);
create index if not exists bans_expiry_idx on public.banned_users (expires_at);

-- Atomically selects and locks a compatible waiting user. Ranking favors the
-- requested gender pairing, shared interests, age group, then longest wait.
create or replace function public.match_anonymous_user(p_user_id uuid)
returns table (
  room_id uuid,
  partner_id uuid,
  partner_username text,
  partner_interests jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  requester public.users_online%rowtype;
  candidate public.users_online%rowtype;
  created_room_id uuid;
begin
  select * into requester
  from public.users_online
  where id = p_user_id
  for update;

  if requester.id is null or requester.status <> 'searching' then
    return;
  end if;

  if exists (
    select 1 from public.banned_users b
    where b.user_id = requester.id and b.expires_at > now()
  ) then
    update public.users_online set status = 'offline' where id = requester.id;
    return;
  end if;

  select c.* into candidate
  from public.users_online c
  where c.id <> requester.id
    and c.status = 'searching'
    and c.communication_type = requester.communication_type
    and c.last_seen_at > now() - interval '90 seconds'
    and not exists (
      select 1 from public.banned_users b
      where b.user_id = c.id and b.expires_at > now()
    )
    and not exists (
      select 1 from public.blocks bl
      where (bl.blocker_id = requester.id and bl.blocked_id = c.id)
         or (bl.blocker_id = c.id and bl.blocked_id = requester.id)
    )
    and not exists (
      select 1 from public.chat_rooms recent
      where recent.created_at > now() - interval '24 hours'
        and ((recent.user1_id = requester.id and recent.user2_id = c.id)
          or (recent.user1_id = c.id and recent.user2_id = requester.id))
    )
  order by
    case
      when requester.gender = 'male' and c.gender = 'female' then 0
      when requester.gender = 'female' and c.gender = 'male' then 0
      when requester.gender in ('other', 'prefer_not_to_say') then 0
      else 1
    end,
    (
      select count(*)
      from jsonb_array_elements_text(requester.interests) r(value)
      join jsonb_array_elements_text(c.interests) i(value) using (value)
    ) desc,
    case when requester.age_group is not null and requester.age_group = c.age_group then 0 else 1 end,
    c.created_at asc
  limit 1
  for update of c skip locked;

  if candidate.id is null then
    update public.users_online set last_seen_at = now() where id = requester.id;
    return;
  end if;

  insert into public.chat_rooms (user1_id, user2_id, mode)
  values (requester.id, candidate.id, requester.communication_type)
  returning id into created_room_id;

  insert into public.room_members (room_id, user_id)
  values (created_room_id, requester.id), (created_room_id, candidate.id);

  update public.users_online
  set status = 'connected', last_seen_at = now()
  where id in (requester.id, candidate.id);

  return query select created_room_id, candidate.id, candidate.username, candidate.interests;
end;
$$;

-- A database-backed fixed-window limiter used by server routes. Keys are SHA-256
-- hashes, so IP addresses or raw session tokens never enter this table.
create or replace function public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_bucket public.rate_limit_buckets%rowtype;
begin
  insert into public.rate_limit_buckets (bucket_key, hit_count, window_started_at)
  values (p_key, 1, now())
  on conflict (bucket_key) do nothing;

  select * into current_bucket
  from public.rate_limit_buckets
  where bucket_key = p_key
  for update;

  if current_bucket.window_started_at <= now() - make_interval(secs => p_window_seconds) then
    update public.rate_limit_buckets
    set hit_count = 1, window_started_at = now()
    where bucket_key = p_key;
    return true;
  end if;

  if current_bucket.hit_count >= p_limit then
    return false;
  end if;

  update public.rate_limit_buckets
  set hit_count = hit_count + 1
  where bucket_key = p_key;
  return true;
end;
$$;

-- Anonymous clients never write directly to application tables. The service
-- role is used by server routes. A short-lived custom JWT permits room members
-- to receive only their room's Realtime message stream.
alter table public.users_online enable row level security;
alter table public.chat_rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.messages enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;
alter table public.banned_users enable row level security;
alter table public.moderation_events enable row level security;
alter table public.rate_limit_buckets enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant select on public.messages to authenticated;

drop policy if exists "room members receive messages" on public.messages;
create policy "room members receive messages"
on public.messages for select to authenticated
using (
  exists (
    select 1 from public.room_members membership
    where membership.room_id = messages.room_id
      and membership.user_id = auth.uid()
  )
);

grant execute on function public.match_anonymous_user(uuid) to service_role;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
revoke execute on function public.match_anonymous_user(uuid) from public, anon, authenticated;
revoke execute on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- Realtime Broadcast authorization. Clients must use private channels named
-- room:<uuid> and a short-lived JWT whose sub is a room member.
drop policy if exists "room members read realtime" on realtime.messages;
create policy "room members read realtime"
on realtime.messages for select to authenticated
using (
  realtime.topic() like 'room:%'
  and exists (
    select 1 from public.room_members membership
    where membership.room_id::text = split_part(realtime.topic(), ':', 2)
      and membership.user_id = auth.uid()
  )
);

drop policy if exists "room members send realtime" on realtime.messages;
create policy "room members send realtime"
on realtime.messages for insert to authenticated
with check (
  realtime.topic() like 'room:%'
  and exists (
    select 1 from public.room_members membership
    where membership.room_id::text = split_part(realtime.topic(), ':', 2)
      and membership.user_id = auth.uid()
  )
);
