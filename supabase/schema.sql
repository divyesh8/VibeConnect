-- VibeConnect production schema for real-human-only matching.
-- Run this file in a Supabase SQL editor for a new project.

create extension if not exists pgcrypto;

drop function if exists public.match_anonymous_user(uuid);

create table if not exists public.online_users (
  id uuid primary key references auth.users(id) on delete cascade,
  session_id uuid not null unique,
  session_token_hash text not null unique,
  username text not null check (
    char_length(username) between 1 and 30
    and username = btrim(username)
    and username ~ '[^[:space:]]'
    and username !~ '[[:cntrl:]]'
  ),
  gender text not null check (gender in ('male', 'female', 'other')),
  communication_mode text not null check (communication_mode in ('text', 'voice', 'video')),
  interests jsonb not null default '[]'::jsonb check (jsonb_typeof(interests) = 'array'),
  age_group text,
  status text not null default 'searching' check (status in ('searching', 'confirming', 'connected', 'offline')),
  warning_count integer not null default 0 check (warning_count >= 0),
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  user1_id uuid not null references public.online_users(id) on delete cascade,
  user2_id uuid not null references public.online_users(id) on delete cascade,
  mode text not null check (mode in ('text', 'voice', 'video')),
  status text not null default 'connecting' check (status in ('connecting', 'active', 'ended')),
  created_at timestamptz not null default now(),
  connected_at timestamptz,
  ended_at timestamptz,
  end_reason text check (end_reason in ('ended', 'skipped', 'peer_left', 'connection_failed', 'stale')),
  check (user1_id <> user2_id)
);

create table if not exists public.match_proposals (
  id uuid primary key default gen_random_uuid(),
  user1_id uuid not null references public.online_users(id) on delete cascade,
  user2_id uuid not null references public.online_users(id) on delete cascade,
  mode text not null check (mode in ('text', 'voice', 'video')),
  user1_accepted boolean not null default false,
  user2_accepted boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'matched', 'declined', 'expired', 'cancelled')),
  room_id uuid references public.chat_rooms(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '30 seconds'),
  created_at timestamptz not null default now(),
  check (user1_id <> user2_id)
);

create table if not exists public.room_members (
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  user_id uuid not null references public.online_users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  active boolean not null default true,
  primary key (room_id, user_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  sender_id uuid not null references public.online_users(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 1000),
  created_at timestamptz not null default now(),
  seen_at timestamptz
);

create table if not exists public.blocks (
  blocker_id uuid not null references public.online_users(id) on delete cascade,
  blocked_id uuid not null references public.online_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.chat_rooms(id) on delete set null,
  reporter_id uuid not null references public.online_users(id) on delete cascade,
  reported_id uuid not null references public.online_users(id) on delete cascade,
  reason text not null check (reason in ('harassment', 'hate_speech', 'sexual_content', 'spam', 'threats', 'underage_concern', 'other')),
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (reporter_id <> reported_id)
);

create table if not exists public.banned_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.online_users(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.moderation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.online_users(id) on delete cascade,
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

create index if not exists online_users_match_queue_idx
  on public.online_users (communication_mode, status, created_at)
  where status = 'searching';
create index if not exists online_users_last_seen_idx on public.online_users (last_seen);
create index if not exists match_proposals_user1_idx on public.match_proposals (user1_id, status, expires_at);
create index if not exists match_proposals_user2_idx on public.match_proposals (user2_id, status, expires_at);
create index if not exists chat_rooms_user1_recent_idx on public.chat_rooms (user1_id, created_at desc);
create index if not exists chat_rooms_user2_recent_idx on public.chat_rooms (user2_id, created_at desc);
create index if not exists room_members_user_idx on public.room_members (user_id, room_id);
create unique index if not exists room_members_one_active_room_per_user_idx on public.room_members (user_id) where active;
create index if not exists messages_room_time_idx on public.messages (room_id, created_at);
create index if not exists reports_status_time_idx on public.reports (status, created_at desc);
create index if not exists bans_expiry_idx on public.banned_users (expires_at);

alter table public.online_users add column if not exists current_room_id uuid references public.chat_rooms(id) on delete set null;

create or replace function public.release_expired_match_proposals()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_rooms active_room
  set status = 'ended', ended_at = coalesce(active_room.ended_at, now()), end_reason = coalesce(active_room.end_reason, 'stale')
  where active_room.status in ('connecting', 'active')
    and exists (
      select 1 from public.online_users stale_user
      where stale_user.status = 'connected'
        and stale_user.last_seen <= now() - interval '25 seconds'
        and stale_user.id in (active_room.user1_id, active_room.user2_id)
    );

  update public.room_members membership
  set active = false
  where membership.active
    and exists (select 1 from public.chat_rooms room where room.id = membership.room_id and room.status = 'ended');

  update public.online_users connected_user
  set status = 'offline', current_room_id = null
  where connected_user.current_room_id is not null
    and exists (select 1 from public.chat_rooms room where room.id = connected_user.current_room_id and room.status = 'ended');

  update public.match_proposals
  set status = 'expired'
  where status = 'pending' and expires_at <= now();

  update public.online_users user_row
  set status = case when user_row.last_seen > now() - interval '25 seconds' then 'searching' else 'offline' end
  where user_row.status = 'confirming'
    and not exists (
      select 1 from public.match_proposals proposal
      where proposal.status = 'pending'
        and proposal.expires_at > now()
        and (proposal.user1_id = user_row.id or proposal.user2_id = user_row.id)
    );

  update public.online_users
  set status = 'offline'
  where status in ('searching', 'confirming')
    and last_seen <= now() - interval '25 seconds';
end;
$$;

-- Finds only another live browser session in the same mode. It creates a
-- proposal, never a room. A room can exist only after both users accept.
create or replace function public.propose_real_match(p_user_id uuid)
returns table (
  proposal_id uuid,
  proposal_status text,
  partner_id uuid,
  partner_username text,
  partner_interests jsonb,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  requester public.online_users%rowtype;
  candidate public.online_users%rowtype;
  existing_proposal public.match_proposals%rowtype;
  created_proposal_id uuid;
  created_expires_at timestamptz;
begin
  perform public.release_expired_match_proposals();

  select * into requester
  from public.online_users
  where id = p_user_id
  for update;

  if requester.id is null or requester.last_seen <= now() - interval '25 seconds' then
    return;
  end if;

  select * into existing_proposal
  from public.match_proposals proposal
  where proposal.status = 'pending'
    and proposal.expires_at > now()
    and (proposal.user1_id = requester.id or proposal.user2_id = requester.id)
  order by proposal.created_at desc
  limit 1;

  if existing_proposal.id is not null then
    return query
    select
      existing_proposal.id,
      existing_proposal.status,
      partner.id,
      partner.username,
      partner.interests,
      existing_proposal.expires_at
    from public.online_users partner
    where partner.id = case when existing_proposal.user1_id = requester.id then existing_proposal.user2_id else existing_proposal.user1_id end;
    return;
  end if;

  if requester.status <> 'searching' then
    return;
  end if;

  if requester.current_room_id is not null then
    update public.online_users set status = 'connected' where id = requester.id;
    return;
  end if;

  if exists (
    select 1 from public.banned_users ban
    where ban.user_id = requester.id and ban.expires_at > now()
  ) then
    update public.online_users set status = 'offline' where id = requester.id;
    return;
  end if;

  select candidate_row.* into candidate
  from public.online_users candidate_row
  where candidate_row.id <> requester.id
    and candidate_row.status = 'searching'
    and candidate_row.current_room_id is null
    and candidate_row.communication_mode = requester.communication_mode
    and candidate_row.last_seen > now() - interval '25 seconds'
    and not exists (
      select 1 from public.banned_users ban
      where ban.user_id = candidate_row.id and ban.expires_at > now()
    )
    and not exists (
      select 1 from public.blocks block_row
      where (block_row.blocker_id = requester.id and block_row.blocked_id = candidate_row.id)
         or (block_row.blocker_id = candidate_row.id and block_row.blocked_id = requester.id)
    )
    and not exists (
      select 1 from public.chat_rooms recent
      where recent.created_at > now() - interval '24 hours'
        and ((recent.user1_id = requester.id and recent.user2_id = candidate_row.id)
          or (recent.user1_id = candidate_row.id and recent.user2_id = requester.id))
    )
  order by
    case
      when (requester.gender = 'male' and candidate_row.gender = 'female')
        or (requester.gender = 'female' and candidate_row.gender = 'male') then 0
      else 1
    end,
    (
      select count(*)
      from jsonb_array_elements_text(requester.interests) requester_interest(value)
      join jsonb_array_elements_text(candidate_row.interests) candidate_interest(value) using (value)
    ) desc,
    case when requester.age_group is not null and requester.age_group = candidate_row.age_group then 0 else 1 end,
    candidate_row.created_at asc
  limit 1
  for update of candidate_row skip locked;

  if candidate.id is null then
    return;
  end if;

  insert into public.match_proposals (user1_id, user2_id, mode)
  values (requester.id, candidate.id, requester.communication_mode)
  returning match_proposals.id, match_proposals.expires_at into created_proposal_id, created_expires_at;

  update public.online_users
  set status = 'confirming'
  where id in (requester.id, candidate.id);

  return query select created_proposal_id, 'pending'::text, candidate.id, candidate.username, candidate.interests, created_expires_at;
end;
$$;

create or replace function public.accept_real_match(p_user_id uuid, p_proposal_id uuid)
returns table (proposal_status text, room_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  proposal public.match_proposals%rowtype;
  first_user public.online_users%rowtype;
  second_user public.online_users%rowtype;
  created_room_id uuid;
begin
  perform public.release_expired_match_proposals();

  select * into proposal
  from public.match_proposals
  where id = p_proposal_id
  for update;

  if proposal.id is null or p_user_id not in (proposal.user1_id, proposal.user2_id) then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  if proposal.status <> 'pending' or proposal.expires_at <= now() then
    return query select proposal.status, proposal.room_id;
    return;
  end if;

  select * into first_user from public.online_users where id = proposal.user1_id for update;
  select * into second_user from public.online_users where id = proposal.user2_id for update;

  if first_user.last_seen <= now() - interval '25 seconds' or second_user.last_seen <= now() - interval '25 seconds'
     or first_user.status <> 'confirming' or second_user.status <> 'confirming' then
    update public.match_proposals set status = 'expired' where id = proposal.id;
    update public.online_users user_row
    set status = case when user_row.last_seen > now() - interval '25 seconds' then 'searching' else 'offline' end
    where user_row.id in (proposal.user1_id, proposal.user2_id);
    return query select 'expired'::text, null::uuid;
    return;
  end if;

  if first_user.current_room_id is not null or second_user.current_room_id is not null then
    update public.match_proposals set status = 'cancelled' where id = proposal.id;
    update public.online_users user_row
    set status = case when user_row.current_room_id is null and user_row.last_seen > now() - interval '25 seconds' then 'searching' else user_row.status end
    where user_row.id in (proposal.user1_id, proposal.user2_id);
    return query select 'cancelled'::text, null::uuid;
    return;
  end if;

  if p_user_id = proposal.user1_id then
    update public.match_proposals set user1_accepted = true where id = proposal.id;
    proposal.user1_accepted := true;
  else
    update public.match_proposals set user2_accepted = true where id = proposal.id;
    proposal.user2_accepted := true;
  end if;

  if proposal.user1_accepted and proposal.user2_accepted then
    insert into public.chat_rooms (user1_id, user2_id, mode, status, connected_at)
    values (
      proposal.user1_id,
      proposal.user2_id,
      proposal.mode,
      case when proposal.mode = 'text' then 'active' else 'connecting' end,
      case when proposal.mode = 'text' then now() else null end
    )
    returning id into created_room_id;

    insert into public.room_members (room_id, user_id, active)
    values (created_room_id, proposal.user1_id, true), (created_room_id, proposal.user2_id, true);

    update public.match_proposals
    set status = 'matched', room_id = created_room_id
    where id = proposal.id;

    update public.online_users
    set status = 'connected', current_room_id = created_room_id
    where id in (proposal.user1_id, proposal.user2_id);

    return query select 'matched'::text, created_room_id;
    return;
  end if;

  return query select 'pending'::text, null::uuid;
end;
$$;

create or replace function public.decline_real_match(p_user_id uuid, p_proposal_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  proposal public.match_proposals%rowtype;
begin
  select * into proposal
  from public.match_proposals
  where id = p_proposal_id
  for update;

  if proposal.id is null or proposal.status <> 'pending'
     or p_user_id not in (proposal.user1_id, proposal.user2_id) then
    return false;
  end if;

  update public.match_proposals set status = 'declined' where id = proposal.id;
  update public.online_users user_row
  set status = case when user_row.last_seen > now() - interval '25 seconds' then 'searching' else 'offline' end
  where user_row.id in (proposal.user1_id, proposal.user2_id);
  return true;
end;
$$;

create or replace function public.mark_user_offline(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  active_proposal public.match_proposals%rowtype;
begin
  select * into active_proposal
  from public.match_proposals proposal
  where proposal.status = 'pending'
    and (proposal.user1_id = p_user_id or proposal.user2_id = p_user_id)
  order by proposal.created_at desc
  limit 1
  for update;

  if active_proposal.id is not null then
    update public.match_proposals set status = 'cancelled' where id = active_proposal.id;
    update public.online_users other_user
    set status = case when other_user.last_seen > now() - interval '25 seconds' then 'searching' else 'offline' end
    where other_user.id = case when active_proposal.user1_id = p_user_id then active_proposal.user2_id else active_proposal.user1_id end;
  end if;

  update public.online_users other_user
  set status = 'offline', current_room_id = null
  where other_user.id <> p_user_id
    and other_user.status = 'connected'
    and exists (
      select 1 from public.chat_rooms active_room
      where active_room.status in ('connecting', 'active')
        and ((active_room.user1_id = p_user_id and active_room.user2_id = other_user.id)
          or (active_room.user2_id = p_user_id and active_room.user1_id = other_user.id))
    );

  update public.chat_rooms
  set status = 'ended', ended_at = coalesce(ended_at, now()), end_reason = coalesce(end_reason, 'peer_left')
  where status in ('connecting', 'active') and (user1_id = p_user_id or user2_id = p_user_id);

  update public.room_members membership
  set active = false
  where membership.active
    and exists (
      select 1 from public.chat_rooms ended_room
      where ended_room.id = membership.room_id
        and ended_room.status = 'ended'
        and (ended_room.user1_id = p_user_id or ended_room.user2_id = p_user_id)
    );

  update public.online_users set status = 'offline', current_room_id = null, last_seen = now() where id = p_user_id;
end;
$$;

create or replace function public.mark_room_connected(p_user_id uuid, p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.chat_rooms%rowtype;
begin
  select * into target_room from public.chat_rooms where id = p_room_id for update;
  if target_room.id is null
     or target_room.status not in ('connecting', 'active')
     or p_user_id not in (target_room.user1_id, target_room.user2_id)
     or not exists (select 1 from public.room_members where room_id = p_room_id and user_id = p_user_id and active) then
    return false;
  end if;
  update public.chat_rooms
  set status = 'active', connected_at = coalesce(connected_at, now())
  where id = p_room_id;
  return true;
end;
$$;

create or replace function public.end_active_room(p_user_id uuid, p_room_id uuid, p_reason text default 'ended')
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.chat_rooms%rowtype;
  other_user_id uuid;
begin
  if p_reason not in ('ended', 'skipped', 'peer_left', 'connection_failed') then
    return false;
  end if;
  select * into target_room from public.chat_rooms where id = p_room_id for update;
  if target_room.id is null or p_user_id not in (target_room.user1_id, target_room.user2_id) then
    return false;
  end if;
  if target_room.status = 'ended' then
    return true;
  end if;
  other_user_id := case when target_room.user1_id = p_user_id then target_room.user2_id else target_room.user1_id end;
  update public.chat_rooms
  set status = 'ended', ended_at = now(), end_reason = p_reason
  where id = p_room_id;
  update public.room_members set active = false where room_id = p_room_id;
  update public.online_users
  set current_room_id = null,
      status = case
        when id = p_user_id and last_seen > now() - interval '25 seconds' then 'searching'
        else 'offline'
      end
  where id in (p_user_id, other_user_id);
  return true;
end;
$$;

create or replace function public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
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

  select * into current_bucket from public.rate_limit_buckets where bucket_key = p_key for update;

  if current_bucket.window_started_at <= now() - make_interval(secs => p_window_seconds) then
    update public.rate_limit_buckets set hit_count = 1, window_started_at = now() where bucket_key = p_key;
    return true;
  end if;
  if current_bucket.hit_count >= p_limit then return false; end if;
  update public.rate_limit_buckets set hit_count = hit_count + 1 where bucket_key = p_key;
  return true;
end;
$$;

create or replace function public.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_members membership
    where membership.room_id = p_room_id and membership.user_id = auth.uid()
  );
$$;

create or replace function public.is_active_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_members membership
    join public.chat_rooms room on room.id = membership.room_id
    where membership.room_id = p_room_id
      and membership.user_id = auth.uid()
      and membership.active
      and room.status in ('connecting', 'active')
  );
$$;

create or replace function public.can_access_queue(p_mode text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.online_users queue_user
    where queue_user.id = auth.uid()
      and queue_user.communication_mode = p_mode
      and queue_user.status in ('searching', 'confirming')
      and queue_user.last_seen > now() - interval '25 seconds'
  );
$$;

alter table public.online_users enable row level security;
alter table public.chat_rooms enable row level security;
alter table public.match_proposals enable row level security;
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
  public.is_room_member(messages.room_id)
);

grant execute on function public.propose_real_match(uuid) to service_role;
grant execute on function public.release_expired_match_proposals() to service_role;
grant execute on function public.accept_real_match(uuid, uuid) to service_role;
grant execute on function public.decline_real_match(uuid, uuid) to service_role;
grant execute on function public.mark_user_offline(uuid) to service_role;
grant execute on function public.mark_room_connected(uuid, uuid) to service_role;
grant execute on function public.end_active_room(uuid, uuid, text) to service_role;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
grant execute on function public.is_room_member(uuid) to authenticated;
grant execute on function public.is_active_room_member(uuid) to authenticated;
grant execute on function public.can_access_queue(text) to authenticated;
revoke execute on function public.propose_real_match(uuid) from public, anon, authenticated;
revoke execute on function public.release_expired_match_proposals() from public, anon, authenticated;
revoke execute on function public.accept_real_match(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.decline_real_match(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.mark_user_offline(uuid) from public, anon, authenticated;
revoke execute on function public.mark_room_connected(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.end_active_room(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.is_room_member(uuid) from public, anon;
revoke execute on function public.is_active_room_member(uuid) from public, anon;
revoke execute on function public.can_access_queue(text) from public, anon;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

drop policy if exists "room members read realtime" on realtime.messages;
create policy "room members read realtime"
on realtime.messages for select to authenticated
using (
  realtime.topic() like 'room:%'
  and public.is_active_room_member(split_part(realtime.topic(), ':', 2)::uuid)
);

drop policy if exists "room members send realtime" on realtime.messages;
create policy "room members send realtime"
on realtime.messages for insert to authenticated
with check (
  realtime.topic() like 'room:%'
  and public.is_active_room_member(split_part(realtime.topic(), ':', 2)::uuid)
);

drop policy if exists "queue users read presence" on realtime.messages;
create policy "queue users read presence"
on realtime.messages for select to authenticated
using (
  realtime.messages.extension = 'presence'
  and realtime.topic() like 'queue:%'
  and public.can_access_queue(split_part(realtime.topic(), ':', 2))
);

drop policy if exists "queue users track presence" on realtime.messages;
create policy "queue users track presence"
on realtime.messages for insert to authenticated
with check (
  realtime.messages.extension = 'presence'
  and realtime.topic() like 'queue:%'
  and public.can_access_queue(split_part(realtime.topic(), ':', 2))
);
