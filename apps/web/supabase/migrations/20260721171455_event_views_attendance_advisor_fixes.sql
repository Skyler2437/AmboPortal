create index if not exists idx_event_attendance_recorded_by on public.event_attendance(recorded_by);

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

drop policy if exists posts_insert_own on public.posts;
create policy posts_insert_own on public.posts
  for insert to authenticated
  with check (user_id = (select auth.uid()));
