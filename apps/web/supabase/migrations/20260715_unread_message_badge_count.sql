-- Authoritative unread chat-message total used by iOS app-icon badges.
-- Authenticated users may request only their own count; the service role may
-- request a recipient's count while dispatching a push notification.
CREATE OR REPLACE FUNCTION public.get_unread_chat_message_count(target_user_id UUID DEFAULT auth.uid())
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  unread_count BIGINT;
BEGIN
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'target_user_id is required';
  END IF;

  IF auth.role() <> 'service_role' AND target_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to read another user''s unread count';
  END IF;

  SELECT COUNT(*)
  INTO unread_count
  FROM public.chat_participants AS participant
  JOIN public.chat_messages AS message
    ON message.group_id = participant.group_id
  WHERE participant.user_id = target_user_id
    AND message.sender_id <> target_user_id
    AND message.created_at > GREATEST(
      COALESCE(participant.last_read_at, '-infinity'::timestamptz),
      COALESCE(participant.deleted_at, '-infinity'::timestamptz)
    );

  RETURN COALESCE(unread_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_unread_chat_message_count(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_unread_chat_message_count(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unread_chat_message_count(UUID) TO service_role;
