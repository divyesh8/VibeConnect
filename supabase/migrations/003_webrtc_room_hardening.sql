-- WebRTC room lifecycle, strict compatibility, and private Realtime policy hardening.
-- Apply after 002_real_human_only_matching.sql (or use schema.sql for a new project).

begin;

update public.online_users set gender = 'other' where gender = 'prefer_not_to_say';
alter table public.online_users drop constraint if exists online_users_gender_check;
alter table public.online_users add constraint online_users_gender_check check (gender in ('male', 'female', 'other'));

alter table public.chat_rooms add column if not exists connected_at timestamptz;
alter table public.chat_rooms add column if not exists end_reason text;
alter table public.chat_rooms drop constraint if exists chat_rooms_status_check;
alter table public.chat_rooms add constraint chat_rooms_status_check check (status in ('connecting', 'active', 'ended'));
alter table public.chat_rooms drop constraint if exists chat_rooms_end_reason_check;
alter table public.chat_rooms add constraint chat_rooms_end_reason_check
  check (end_reason is null or end_reason in ('ended', 'skipped', 'peer_left', 'connection_failed', 'stale'));
update public.chat_rooms set connected_at = coalesce(connected_at, created_at) where status = 'active';

alter table public.room_members add column if not exists active boolean not null default true;
update public.room_members membership
set active = exists (
  select 1 from public.chat_rooms room
  where room.id = membership.room_id and room.status in ('connecting', 'active')
);
create unique index if not exists room_members_one_active_room_per_user_idx
  on public.room_members (user_id) where active;

alter table public.online_users add column if not exists current_room_id uuid references public.chat_rooms(id) on delete set null;
update public.online_users queue_user
set current_room_id = (
  select membership.room_id
  from public.room_members membership
  join public.chat_rooms room on room.id = membership.room_id
  where membership.user_id = queue_user.id and membership.active and room.status in ('connecting', 'active')
  order by room.created_at desc
  limit 1
);

alter table public.reports drop constraint if exists reports_reason_check;
alter table public.reports add constraint reports_reason_check
  check (reason in ('harassment', 'hate_speech', 'sexual_content', 'spam', 'threats', 'underage_concern', 'other'));

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

  update public.match_proposals set status = 'expired' where status = 'pending' and expires_at <= now();

  update public.online_users user_row
  set status = case when user_row.last_seen > now() - interval '25 seconds' then 'searching' else 'offline' end
  where user_row.status = 'confirming'
    and not exists (
      select 1 from public.match_proposals proposal
      where proposal.status = 'pending' and proposal.expires_at > now()
        and (proposal.user1_id = user_row.id or proposal.user2_id = user_row.id)
    );

  update public.online_users set status = 'offline'
  where status in ('searching', 'confirming') and last_seen <= now() - interval '25 seconds';
end;
$$;

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
  select * into requester from public.online_users where id = p_user_id for update;
  if requester.id is null or requester.last_seen <= now() - interval '25 seconds' then return; end if;

  select * into existing_proposal
  from public.match_proposals proposal
  where proposal.status = 'pending' and proposal.expires_at > now()
    and (proposal.user1_id = requester.id or proposal.user2_id = requester.id)
  order by proposal.created_at desc limit 1;

  if existing_proposal.id is not null then
    return query
    select existing_proposal.id, existing_proposal.status, partner.id, partner.username, partner.interests, existing_proposal.expires_at
    from public.online_users partner
    where partner.id = case when existing_proposal.user1_id = requester.id then existing_proposal.user2_id else existing_proposal.user1_id end;
    return;
  end if;

  if requester.status <> 'searching' then return; end if;
  if requester.current_room_id is not null then
    update public.online_users set status = 'connected' where id = requester.id;
    return;
  end if;
  if exists (select 1 from public.banned_users ban where ban.user_id = requester.id and ban.expires_at > now()) then
    update public.online_users set status = 'offline' where id = requester.id;
    return;
  end if;

  select candidate_row.* into candidate
  from public.online_users candidate_row
  where candidate_row.id <> requester.id
    and candidate_row.status = 'searching'
    and candidate_row.current_room_id is null
    and candidate_row.communication_mode = requester.communication_mode
    and (
      (requester.gender = 'male' and candidate_row.gender = 'female')
      or (requester.gender = 'female' and candidate_row.gender = 'male')
      or (requester.gender = 'other' and candidate_row.gender = 'other')
    )
    and candidate_row.last_seen > now() - interval '25 seconds'
    and not exists (select 1 from public.banned_users ban where ban.user_id = candidate_row.id and ban.expires_at > now())
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
  order by (
    select count(*)
    from jsonb_array_elements_text(requester.interests) requester_interest(value)
    join jsonb_array_elements_text(candidate_row.interests) candidate_interest(value) using (value)
  ) desc,
  case when requester.age_group is not null and requester.age_group = candidate_row.age_group then 0 else 1 end,
  candidate_row.created_at asc
  limit 1
  for update of candidate_row skip locked;

  if candidate.id is null then return; end if;
  insert into public.match_proposals (user1_id, user2_id, mode)
  values (requester.id, candidate.id, requester.communication_mode)
  returning match_proposals.id, match_proposals.expires_at into created_proposal_id, created_expires_at;
  update public.online_users set status = 'confirming' where id in (requester.id, candidate.id);
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
  select * into proposal from public.match_proposals where id = p_proposal_id for update;
  if proposal.id is null or p_user_id not in (proposal.user1_id, proposal.user2_id) then
    return query select 'invalid'::text, null::uuid; return;
  end if;
  if proposal.status <> 'pending' or proposal.expires_at <= now() then
    return query select proposal.status, proposal.room_id; return;
  end if;
  select * into first_user from public.online_users where id = proposal.user1_id for update;
  select * into second_user from public.online_users where id = proposal.user2_id for update;
  if first_user.last_seen <= now() - interval '25 seconds' or second_user.last_seen <= now() - interval '25 seconds'
     or first_user.status <> 'confirming' or second_user.status <> 'confirming' then
    update public.match_proposals set status = 'expired' where id = proposal.id;
    update public.online_users user_row
    set status = case when user_row.last_seen > now() - interval '25 seconds' then 'searching' else 'offline' end
    where user_row.id in (proposal.user1_id, proposal.user2_id);
    return query select 'expired'::text, null::uuid; return;
  end if;
  if first_user.current_room_id is not null or second_user.current_room_id is not null then
    update public.match_proposals set status = 'cancelled' where id = proposal.id;
    update public.online_users user_row
    set status = case when user_row.current_room_id is null and user_row.last_seen > now() - interval '25 seconds' then 'searching' else user_row.status end
    where user_row.id in (proposal.user1_id, proposal.user2_id);
    return query select 'cancelled'::text, null::uuid; return;
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
      proposal.user1_id, proposal.user2_id, proposal.mode,
      case when proposal.mode = 'text' then 'active' else 'connecting' end,
      case when proposal.mode = 'text' then now() else null end
    ) returning id into created_room_id;
    insert into public.room_members (room_id, user_id, active)
    values (created_room_id, proposal.user1_id, true), (created_room_id, proposal.user2_id, true);
    update public.match_proposals set status = 'matched', room_id = created_room_id where id = proposal.id;
    update public.online_users set status = 'connected', current_room_id = created_room_id
    where id in (proposal.user1_id, proposal.user2_id);
    return query select 'matched'::text, created_room_id; return;
  end if;
  return query select 'pending'::text, null::uuid;
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
  where proposal.status = 'pending' and (proposal.user1_id = p_user_id or proposal.user2_id = p_user_id)
  order by proposal.created_at desc limit 1 for update;
  if active_proposal.id is not null then
    update public.match_proposals set status = 'cancelled' where id = active_proposal.id;
    update public.online_users other_user
    set status = case when other_user.last_seen > now() - interval '25 seconds' then 'searching' else 'offline' end
    where other_user.id = case when active_proposal.user1_id = p_user_id then active_proposal.user2_id else active_proposal.user1_id end;
  end if;
  update public.online_users other_user set status = 'offline', current_room_id = null
  where other_user.id <> p_user_id and other_user.status = 'connected'
    and exists (
      select 1 from public.chat_rooms active_room
      where active_room.status in ('connecting', 'active')
        and ((active_room.user1_id = p_user_id and active_room.user2_id = other_user.id)
          or (active_room.user2_id = p_user_id and active_room.user1_id = other_user.id))
    );
  update public.chat_rooms
  set status = 'ended', ended_at = coalesce(ended_at, now()), end_reason = coalesce(end_reason, 'peer_left')
  where status in ('connecting', 'active') and (user1_id = p_user_id or user2_id = p_user_id);
  update public.room_members membership set active = false
  where membership.active and exists (
    select 1 from public.chat_rooms ended_room
    where ended_room.id = membership.room_id and ended_room.status = 'ended'
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
declare target_room public.chat_rooms%rowtype;
begin
  select * into target_room from public.chat_rooms where id = p_room_id for update;
  if target_room.id is null or target_room.status not in ('connecting', 'active')
     or p_user_id not in (target_room.user1_id, target_room.user2_id)
     or not exists (select 1 from public.room_members where room_id = p_room_id and user_id = p_user_id and active) then
    return false;
  end if;
  update public.chat_rooms set status = 'active', connected_at = coalesce(connected_at, now()) where id = p_room_id;
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
  if p_reason not in ('ended', 'skipped', 'peer_left', 'connection_failed') then return false; end if;
  select * into target_room from public.chat_rooms where id = p_room_id for update;
  if target_room.id is null or p_user_id not in (target_room.user1_id, target_room.user2_id) then return false; end if;
  if target_room.status = 'ended' then return true; end if;
  other_user_id := case when target_room.user1_id = p_user_id then target_room.user2_id else target_room.user1_id end;
  update public.chat_rooms set status = 'ended', ended_at = now(), end_reason = p_reason where id = p_room_id;
  update public.room_members set active = false where room_id = p_room_id;
  update public.online_users
  set current_room_id = null,
      status = case when id = p_user_id and last_seen > now() - interval '25 seconds' then 'searching' else 'offline' end
  where id in (p_user_id, other_user_id);
  return true;
end;
$$;

create or replace function public.is_room_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.room_members where room_id = p_room_id and user_id = auth.uid());
$$;

create or replace function public.is_active_room_member(p_room_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.room_members membership
    join public.chat_rooms room on room.id = membership.room_id
    where membership.room_id = p_room_id and membership.user_id = auth.uid()
      and membership.active and room.status in ('connecting', 'active')
  );
$$;

create or replace function public.can_access_queue(p_mode text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.online_users
    where id = auth.uid() and communication_mode = p_mode
      and status in ('searching', 'confirming') and last_seen > now() - interval '25 seconds'
  );
$$;

grant execute on function public.mark_room_connected(uuid, uuid) to service_role;
grant execute on function public.end_active_room(uuid, uuid, text) to service_role;
grant execute on function public.is_room_member(uuid) to authenticated;
grant execute on function public.is_active_room_member(uuid) to authenticated;
grant execute on function public.can_access_queue(text) to authenticated;
revoke execute on function public.mark_room_connected(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.end_active_room(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.is_room_member(uuid) from public, anon;
revoke execute on function public.is_active_room_member(uuid) from public, anon;
revoke execute on function public.can_access_queue(text) from public, anon;

drop policy if exists "room members receive messages" on public.messages;
create policy "room members receive messages" on public.messages for select to authenticated
using (public.is_room_member(messages.room_id));

drop policy if exists "room members read realtime" on realtime.messages;
create policy "room members read realtime" on realtime.messages for select to authenticated
using (
  realtime.topic() like 'room:%'
  and public.is_active_room_member(split_part(realtime.topic(), ':', 2)::uuid)
);

drop policy if exists "room members send realtime" on realtime.messages;
create policy "room members send realtime" on realtime.messages for insert to authenticated
with check (
  realtime.topic() like 'room:%'
  and public.is_active_room_member(split_part(realtime.topic(), ':', 2)::uuid)
);

drop policy if exists "queue users read presence" on realtime.messages;
create policy "queue users read presence" on realtime.messages for select to authenticated
using (
  realtime.messages.extension = 'presence'
  and realtime.topic() like 'queue:%'
  and public.can_access_queue(split_part(realtime.topic(), ':', 2))
);

drop policy if exists "queue users track presence" on realtime.messages;
create policy "queue users track presence" on realtime.messages for insert to authenticated
with check (
  realtime.messages.extension = 'presence'
  and realtime.topic() like 'queue:%'
  and public.can_access_queue(split_part(realtime.topic(), ':', 2))
);

commit;
