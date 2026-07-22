create table if not exists public.event_views (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  unique (event_id, user_id)
);
create index if not exists idx_event_views_event_id on public.event_views(event_id);
create index if not exists idx_event_views_user_id on public.event_views(user_id);
alter table public.event_views enable row level security;
revoke all on public.event_views from anon, authenticated;
grant select, insert on public.event_views to authenticated;

create table if not exists public.event_attendance (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null check (status in ('present', 'absent', 'excused_absent')),
  recorded_by uuid not null references public.users(id),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index if not exists idx_event_attendance_user_id on public.event_attendance(user_id);
create index if not exists idx_event_attendance_recorded_by on public.event_attendance(recorded_by);
alter table public.event_attendance enable row level security;
revoke all on public.event_attendance from anon, authenticated;
grant select on public.event_attendance to authenticated;

create or replace function public.can_manage_event(check_event_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.events e
    join public.users u on u.id = auth.uid()
    where e.id = check_event_id
      and (u.role in ('admin', 'superadmin') or e.created_by = auth.uid())
  );
$$;
revoke execute on function public.can_manage_event(uuid) from public, anon, authenticated;
grant execute on function public.can_manage_event(uuid) to authenticated;

drop policy if exists event_views_select_authenticated on public.event_views;
create policy event_views_select_authenticated on public.event_views
  for select to authenticated using (true);
drop policy if exists event_views_insert_own on public.event_views;
create policy event_views_insert_own on public.event_views
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists event_attendance_select_visible on public.event_attendance;
create policy event_attendance_select_visible on public.event_attendance
  for select to authenticated
  using (
    public.can_manage_event(event_id)
    or (
      status = 'present'
      and exists (
        select 1 from public.users u
        where u.id = (select auth.uid())
          and u.role in ('student', 'admin', 'superadmin')
      )
    )
  );

create or replace function public.save_event_attendance(
  target_event_id uuid,
  changes jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  change_row jsonb;
  changed_user_id uuid;
  changed_status text;
  seen_user_ids uuid[] := array[]::uuid[];
begin
  if auth.uid() is null or not public.can_manage_event(target_event_id) then
    raise exception 'Not authorized to manage this event' using errcode = '42501';
  end if;

  if jsonb_typeof(changes) <> 'array' then
    raise exception 'changes must be a JSON array' using errcode = '22023';
  end if;

  for change_row in select value from jsonb_array_elements(changes)
  loop
    begin
      changed_user_id := (change_row ->> 'user_id')::uuid;
    exception when others then
      raise exception 'Each change requires a valid user_id' using errcode = '22023';
    end;

    if changed_user_id = any(seen_user_ids) then
      raise exception 'Duplicate user_id in attendance changes' using errcode = '22023';
    end if;
    seen_user_ids := array_append(seen_user_ids, changed_user_id);

    if not exists (
      select 1 from public.users
      where id = changed_user_id and role = 'student'
    ) then
      raise exception 'Attendance target must be a student' using errcode = '22023';
    end if;

    changed_status := change_row ->> 'status';
    if changed_status is null then
      delete from public.event_attendance
      where event_id = target_event_id and user_id = changed_user_id;
    elsif changed_status in ('present', 'absent', 'excused_absent') then
      insert into public.event_attendance(event_id, user_id, status, recorded_by, updated_at)
      values (target_event_id, changed_user_id, changed_status, auth.uid(), now())
      on conflict (event_id, user_id) do update
      set status = excluded.status,
          recorded_by = excluded.recorded_by,
          updated_at = excluded.updated_at;
    else
      raise exception 'Invalid attendance status' using errcode = '22023';
    end if;
  end loop;
end;
$$;
revoke execute on function public.save_event_attendance(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_event_attendance(uuid, jsonb) to authenticated;

drop policy if exists "Admins can insert events" on public.events;
drop policy if exists "Members can insert events" on public.events;
drop policy if exists events_insert_own on public.events;
create policy events_insert_own on public.events
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.users u
      where u.id = (select auth.uid())
        and u.role in ('student', 'admin', 'superadmin')
    )
  );

drop policy if exists "Admins can update events" on public.events;
drop policy if exists events_update_manager on public.events;
create policy events_update_manager on public.events
  for update to authenticated
  using (public.can_manage_event(id))
  with check (
    public.can_manage_event(id)
    and (
      created_by = (select auth.uid())
      or exists (
        select 1
        from public.users u
        where u.id = (select auth.uid())
          and u.role in ('admin', 'superadmin')
      )
    )
  );

drop policy if exists "Admins can delete events" on public.events;
drop policy if exists events_delete_manager on public.events;
create policy events_delete_manager on public.events
  for delete to authenticated
  using (public.can_manage_event(id));

drop policy if exists "Authenticated can view rsvp options" on public.event_rsvp_options;
drop policy if exists event_rsvp_options_select_authenticated on public.event_rsvp_options;
create policy event_rsvp_options_select_authenticated on public.event_rsvp_options
  for select to authenticated
  using (true);

drop policy if exists "Admins can manage rsvp options" on public.event_rsvp_options;
drop policy if exists "Members can manage rsvp options" on public.event_rsvp_options;
drop policy if exists event_rsvp_options_insert_manager on public.event_rsvp_options;
create policy event_rsvp_options_insert_manager on public.event_rsvp_options
  for insert to authenticated
  with check (public.can_manage_event(event_id));
drop policy if exists event_rsvp_options_update_manager on public.event_rsvp_options;
create policy event_rsvp_options_update_manager on public.event_rsvp_options
  for update to authenticated
  using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));
drop policy if exists event_rsvp_options_delete_manager on public.event_rsvp_options;
create policy event_rsvp_options_delete_manager on public.event_rsvp_options
  for delete to authenticated
  using (public.can_manage_event(event_id));

drop policy if exists "Authenticated users can create posts" on public.posts;
drop policy if exists posts_insert_own on public.posts;
create policy posts_insert_own on public.posts
  for insert to authenticated
  with check (user_id = (select auth.uid()));
