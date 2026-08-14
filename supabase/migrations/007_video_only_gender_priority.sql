-- Make every new match a video call. Prefer a male/female pairing first,
-- then the same gender, then any remaining eligible person.
update public.match_proposals
set status = 'cancelled'
where status = 'pending';

update public.online_users
set communication_mode = 'video', interests = '[]'::jsonb;

alter table public.online_users
  drop constraint if exists online_users_communication_mode_check;

alter table public.online_users
  alter column communication_mode set default 'video';

alter table public.online_users
  add constraint online_users_communication_mode_check
  check (communication_mode = 'video');

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
    and candidate_row.communication_mode = 'video'
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
    return;
  end if;

  insert into public.match_proposals (user1_id, user2_id, mode)
  values (requester.id, candidate.id, 'video')
  returning match_proposals.id, match_proposals.expires_at into created_proposal_id, created_expires_at;

  update public.online_users
  set status = 'confirming'
  where id in (requester.id, candidate.id);

  return query select created_proposal_id, 'pending'::text, candidate.id, candidate.username, candidate.interests, created_expires_at;
end;
$$;
