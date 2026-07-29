-- Keep RSVP explanations out of the generally visible event_rsvps roster.
-- Students may read only their own explanation; admins and superadmins may
-- read all explanations for event planning.
create table public.event_rsvp_explanations (
  event_id uuid not null,
  user_id uuid not null,
  explanation text not null,
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id),
  constraint event_rsvp_explanations_rsvp_fkey
    foreign key (event_id, user_id)
    references public.event_rsvps(event_id, user_id)
    on delete cascade,
  constraint event_rsvp_explanations_length_check
    check (char_length(btrim(explanation)) between 50 and 500)
);

alter table public.event_rsvp_explanations enable row level security;
create index event_rsvp_explanations_user_id_idx
  on public.event_rsvp_explanations(user_id);
revoke all on table public.event_rsvp_explanations from public, anon, authenticated;
grant select on table public.event_rsvp_explanations to authenticated;

create policy event_rsvp_explanations_select_visible
  on public.event_rsvp_explanations
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1
      from public.users u
      where u.id = (select auth.uid())
        and u.role in ('admin', 'superadmin')
    )
  );

-- All RSVP writes go through the two validated wrapper functions below.
-- This internal function is intentionally not executable by API roles.
create function public.write_event_rsvp(
  target_event_id uuid,
  target_user_id uuid,
  target_status text,
  target_rsvp_option_id uuid,
  target_explanation text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_explanation text := btrim(target_explanation);
begin
  if target_status is null or target_status not in ('going', 'maybe', 'no') then
    raise exception 'Invalid RSVP status' using errcode = '22023';
  end if;

  if target_status in ('maybe', 'no')
    and (
      clean_explanation is null
      or char_length(clean_explanation) < 50
      or char_length(clean_explanation) > 500
    )
  then
    raise exception 'Maybe and Can''t Go RSVPs require an explanation of 50 to 500 characters'
      using errcode = '22023';
  end if;

  if target_status <> 'going' and target_rsvp_option_id is not null then
    raise exception 'Only Going RSVPs may use a custom RSVP option'
      using errcode = '22023';
  end if;

  if target_rsvp_option_id is not null and not exists (
    select 1
    from public.event_rsvp_options option
    where option.id = target_rsvp_option_id
      and option.event_id = target_event_id
  ) then
    raise exception 'RSVP option does not belong to this event'
      using errcode = '22023';
  end if;

  insert into public.event_rsvps(event_id, user_id, status, rsvp_option_id)
  values (
    target_event_id,
    target_user_id,
    target_status,
    case when target_status = 'going' then target_rsvp_option_id else null end
  )
  on conflict (event_id, user_id) do update
  set status = excluded.status,
      rsvp_option_id = excluded.rsvp_option_id;

  if target_status in ('maybe', 'no') then
    insert into public.event_rsvp_explanations(
      event_id,
      user_id,
      explanation,
      updated_at
    )
    values (
      target_event_id,
      target_user_id,
      clean_explanation,
      now()
    )
    on conflict (event_id, user_id) do update
    set explanation = excluded.explanation,
        updated_at = excluded.updated_at;
  else
    delete from public.event_rsvp_explanations
    where event_id = target_event_id
      and user_id = target_user_id;
  end if;
end;
$$;

revoke execute on function public.write_event_rsvp(uuid, uuid, text, uuid, text)
  from public, anon, authenticated, service_role;

create function public.save_event_rsvp(
  target_event_id uuid,
  target_status text,
  target_rsvp_option_id uuid default null,
  target_explanation text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.users u
    where u.id = current_user_id
      and u.role in ('student', 'admin', 'superadmin')
  ) then
    raise exception 'Not authorized to RSVP' using errcode = '42501';
  end if;

  perform public.write_event_rsvp(
    target_event_id,
    current_user_id,
    target_status,
    target_rsvp_option_id,
    target_explanation
  );
end;
$$;

revoke execute on function public.save_event_rsvp(uuid, text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.save_event_rsvp(uuid, text, uuid, text)
  to authenticated;

create function public.save_event_rsvp_for_user(
  target_event_id uuid,
  target_user_id uuid,
  target_status text,
  target_rsvp_option_id uuid default null,
  target_explanation text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.users u
    where u.id = target_user_id
      and u.role in ('student', 'admin', 'superadmin')
  ) then
    raise exception 'Not authorized to RSVP' using errcode = '42501';
  end if;

  perform public.write_event_rsvp(
    target_event_id,
    target_user_id,
    target_status,
    target_rsvp_option_id,
    target_explanation
  );
end;
$$;

revoke execute on function public.save_event_rsvp_for_user(uuid, uuid, text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.save_event_rsvp_for_user(uuid, uuid, text, uuid, text)
  to service_role;

-- Prevent direct inserts/updates from bypassing the explanation requirement.
-- Deleting an RSVP remains available and cascades its explanation.
revoke insert, update on table public.event_rsvps from public, anon, authenticated;
