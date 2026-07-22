revoke all on public.event_views from anon, authenticated;
grant select, insert on public.event_views to authenticated;

revoke execute on function public.can_manage_event(uuid) from public, anon, authenticated;
grant execute on function public.can_manage_event(uuid) to authenticated;

revoke execute on function public.save_event_attendance(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_event_attendance(uuid, jsonb) to authenticated;
