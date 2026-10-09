-- PostgREST supplies request.jwt.claims as JSON on current PostgreSQL.
-- Keep the legacy fallback for older callers without widening execution grants.
create or replace function public.save_event_rsvp_for_user(
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
  if coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    nullif(current_setting('request.jwt.claim.role', true), ''),
    ''
  ) <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.users u
    where u.id = target_user_id
      and u.role in ('student', 'admin', 'superadmin')
  ) then
    raise exception 'Not authorized to RSVP' using errcode = '42501';
  end if;

  perform public.write_event_rsvp(
    target_event_id, target_user_id, target_status,
    target_rsvp_option_id, target_explanation
  );
end;
$$;

revoke execute on function public.save_event_rsvp_for_user(uuid, uuid, text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.save_event_rsvp_for_user(uuid, uuid, text, uuid, text)
  to service_role;
