-- Keep direct mobile event writes limited to user-editable columns. RLS still
-- controls which rows may be inserted, updated, selected, or deleted.
revoke insert, update on table public.events from public, anon, authenticated;
grant insert (title, description, start_time, end_time, type, uniform, created_by)
  on public.events to authenticated;
grant update (title, description, start_time, end_time, type, uniform)
  on public.events to authenticated;

-- Event ownership grants manager access only while the creator is still a
-- student. Admin and superadmin access continues to be role-based.
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
      and (
        u.role in ('admin', 'superadmin')
        or (u.role = 'student' and e.created_by = auth.uid())
      )
  );
$$;
revoke execute on function public.can_manage_event(uuid) from public, anon, authenticated;
grant execute on function public.can_manage_event(uuid) to authenticated;

-- Attendance history should survive deletion of the user who recorded it.
alter table public.event_attendance
  alter column recorded_by drop not null;
alter table public.event_attendance
  drop constraint if exists event_attendance_recorded_by_fkey;
alter table public.event_attendance
  add constraint event_attendance_recorded_by_fkey
  foreign key (recorded_by) references public.users(id) on delete set null;

-- NOT VALID avoids blocking deployment on legacy rows while enforcing these
-- invariants for all new or changed rows. Validate after legacy-data auditing.
alter table public.events
  add constraint events_title_content_check
  check (char_length(btrim(title)) > 0 and char_length(title) <= 200) not valid;
alter table public.events
  add constraint events_description_length_check
  check (description is null or char_length(description) <= 5000) not valid;
alter table public.events
  add constraint events_uniform_length_check
  check (uniform is null or char_length(uniform) <= 500) not valid;
alter table public.events
  add constraint events_type_length_check
  check (type is null or char_length(type) <= 100) not valid;
alter table public.events
  add constraint events_time_order_check
  check (end_time > start_time) not valid;

-- Production preflight found no legacy violations, so finish with fully
-- validated constraints while retaining the low-lock add-then-validate path.
alter table public.events validate constraint events_title_content_check;
alter table public.events validate constraint events_description_length_check;
alter table public.events validate constraint events_uniform_length_check;
alter table public.events validate constraint events_type_length_check;
alter table public.events validate constraint events_time_order_check;
