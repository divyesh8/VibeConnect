-- Keep the current conversation active while a user looks for another vibe.
-- The old room is ended only after the replacement user accepts.

begin;

alter table public.match_proposals
  add column if not exists source_room_id uuid references public.chat_rooms(id) on delete set null;

create index if not exists match_proposals_source_room_idx
  on public.match_proposals (source_room_id, status, expires_at)
  where source_room_id is not null;

create or replace function public.request_another_vibe(p_user_id uuid, p_room_id uuid)
returns table (
  result_status text,
  proposal_id uuid,
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
  current_room public.chat_rooms%rowtype;
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

  select * into current_room
  from public.chat_rooms
  where id = p_room_id
  for update;

  if requester.id is null
     or requester.status <> 'connected'
     or requester.current_room_id is distinct from p_room_id
     or requester.last_seen <= now() - interval '25 seconds'
     or current_room.id is null
     or current_room.status not in ('connecting', 'active')
     or requester.id not in (current_room.user1_id, current_room.user2_id)
     or not exists (
       select 1 from public.room_members membership
       where membership.room_id = p_room_id
         and membership.user_id = requester.id
         and membership.active
     ) then
    return query select 'invalid'::text, null::uuid, null::uuid, null::text, null::jsonb, null::timestamptz;
    return;
  end if;

  select * into existing_proposal
  from public.match_proposals proposal
  where proposal.user1_id = requester.id
    and proposal.source_room_id = p_room_id
    and proposal.status = 'pending'
    and proposal.expires_at > now()
  order by proposal.created_at desc
  limit 1;

  if existing_proposal.id is not null then
    return query
    select
      'pending'::text,
      existing_proposal.id,
      partner.id,
      partner.username,
      partner.interests,
      existing_proposal.expires_at
    from public.online_users partner
    where partner.id = existing_proposal.user2_id;
    return;
  end if;

  select candidate_row.* into candidate
  from public.online_users candidate_row
  where candidate_row.id <> requester.id
    and candidate_row.status = 'searching'
    and candidate_row.current_room_id is null
    and candidate_row.communication_mode = current_room.mode
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
      when requester.gender = candidate_row.gender then 1
      else 2
    end,
    candidate_row.created_at asc
  limit 1
  for update of candidate_row skip locked;

  if candidate.id is null then
    return query select 'no_match'::text, null::uuid, null::uuid, null::text, null::jsonb, null::timestamptz;
    return;
  end if;

  insert into public.match_proposals (
    user1_id,
    user2_id,
    mode,
    user1_accepted,
    source_room_id
  ) values (
    requester.id,
    candidate.id,
    current_room.mode,
    true,
    current_room.id
  )
  returning match_proposals.id, match_proposals.expires_at
  into created_proposal_id, created_expires_at;

  update public.online_users
  set status = 'confirming'
  where id = candidate.id;

  return query
  select
    'pending'::text,
    created_proposal_id,
    candidate.id,
    candidate.username,
    candidate.interests,
    created_expires_at;
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
  source_room public.chat_rooms%rowtype;
  displaced_user_id uuid;
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

  if first_user.last_seen <= now() - interval '25 seconds'
     or second_user.last_seen <= now() - interval '25 seconds' then
    update public.match_proposals set status = 'expired' where id = proposal.id;
    update public.online_users user_row
    set status = case
      when user_row.current_room_id is not null then 'connected'
      when user_row.last_seen > now() - interval '25 seconds' then 'searching'
      else 'offline'
    end
    where user_row.id in (proposal.user1_id, proposal.user2_id);
    return query select 'expired'::text, null::uuid;
    return;
  end if;

  if proposal.source_room_id is null then
    if first_user.status <> 'confirming'
       or second_user.status <> 'confirming'
       or first_user.current_room_id is not null
       or second_user.current_room_id is not null then
      update public.match_proposals set status = 'cancelled' where id = proposal.id;
      update public.online_users user_row
      set status = case
        when user_row.current_room_id is not null then 'connected'
        when user_row.last_seen > now() - interval '25 seconds' then 'searching'
        else 'offline'
      end
      where user_row.id in (proposal.user1_id, proposal.user2_id);
      return query select 'cancelled'::text, null::uuid;
      return;
    end if;
  else
    select * into source_room
    from public.chat_rooms
    where id = proposal.source_room_id
    for update;

    if source_room.id is null
       or source_room.status not in ('connecting', 'active')
       or proposal.user1_id not in (source_room.user1_id, source_room.user2_id)
       or first_user.status <> 'connected'
       or first_user.current_room_id is distinct from source_room.id
       or second_user.status <> 'confirming'
       or second_user.current_room_id is not null then
      update public.match_proposals set status = 'cancelled' where id = proposal.id;
      update public.online_users user_row
      set status = case
        when user_row.current_room_id is not null then 'connected'
        when user_row.last_seen > now() - interval '25 seconds' then 'searching'
        else 'offline'
      end
      where user_row.id in (proposal.user1_id, proposal.user2_id);
      return query select 'cancelled'::text, null::uuid;
      return;
    end if;
  end if;

  if p_user_id = proposal.user1_id then
    update public.match_proposals set user1_accepted = true where id = proposal.id;
    proposal.user1_accepted := true;
  else
    update public.match_proposals set user2_accepted = true where id = proposal.id;
    proposal.user2_accepted := true;
  end if;

  if proposal.user1_accepted and proposal.user2_accepted then
    if proposal.source_room_id is not null then
      displaced_user_id := case
        when source_room.user1_id = proposal.user1_id then source_room.user2_id
        else source_room.user1_id
      end;
      perform 1 from public.online_users where id = displaced_user_id for update;

      update public.chat_rooms
      set status = 'ended', ended_at = now(), end_reason = 'skipped'
      where id = source_room.id;

      update public.room_members
      set active = false
      where room_id = source_room.id;

      update public.online_users
      set current_room_id = null, status = 'offline'
      where id = displaced_user_id and current_room_id = source_room.id;
    end if;

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
    values
      (created_room_id, proposal.user1_id, true),
      (created_room_id, proposal.user2_id, true);

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

  if proposal.id is null
     or proposal.status <> 'pending'
     or p_user_id not in (proposal.user1_id, proposal.user2_id) then
    return false;
  end if;

  update public.match_proposals set status = 'declined' where id = proposal.id;
  update public.online_users user_row
  set status = case
    when user_row.current_room_id is not null then 'connected'
    when user_row.last_seen > now() - interval '25 seconds' then 'searching'
    else 'offline'
  end
  where user_row.id in (proposal.user1_id, proposal.user2_id);
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

  select * into target_room
  from public.chat_rooms
  where id = p_room_id
  for update;

  if target_room.id is null or p_user_id not in (target_room.user1_id, target_room.user2_id) then
    return false;
  end if;

  update public.match_proposals
  set status = 'cancelled'
  where source_room_id = p_room_id and status = 'pending';

  update public.online_users user_row
  set status = case
    when user_row.current_room_id is not null then 'connected'
    when user_row.last_seen > now() - interval '25 seconds' then 'searching'
    else 'offline'
  end
  where user_row.status = 'confirming'
    and user_row.id in (
      select proposal.user1_id from public.match_proposals proposal where proposal.source_room_id = p_room_id
      union
      select proposal.user2_id from public.match_proposals proposal where proposal.source_room_id = p_room_id
    );

  if target_room.status = 'ended' then
    return true;
  end if;

  other_user_id := case
    when target_room.user1_id = p_user_id then target_room.user2_id
    else target_room.user1_id
  end;

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

grant execute on function public.request_another_vibe(uuid, uuid) to service_role;
revoke execute on function public.request_another_vibe(uuid, uuid) from public, anon, authenticated;

commit;
