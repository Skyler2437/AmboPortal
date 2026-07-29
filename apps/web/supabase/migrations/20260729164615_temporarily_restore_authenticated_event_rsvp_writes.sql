-- Temporary compatibility for App Store version 1.4.1, which writes RSVP
-- changes directly to event_rsvps. Row-level security continues to restrict
-- authenticated users to their own RSVP rows.
--
-- Revoke these grants after the RPC-based mobile release is broadly adopted.
grant insert, update on table public.event_rsvps to authenticated;
