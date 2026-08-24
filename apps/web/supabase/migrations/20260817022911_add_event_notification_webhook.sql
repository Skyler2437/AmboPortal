-- Route every new event through the same authenticated notification webhook
-- already used by posts. Copying the existing trigger at migration time keeps
-- the webhook URL and secret out of source control.
--
-- Deployment order matters: deploy the handler with its `events` case before
-- applying this migration in production.
DO $migration$
DECLARE
  source_definition TEXT;
  target_definition TEXT;
BEGIN
  SELECT pg_get_triggerdef(trigger.oid, true)
    INTO source_definition
  FROM pg_trigger AS trigger
  JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  JOIN pg_proc AS procedure ON procedure.oid = trigger.tgfoid
  JOIN pg_namespace AS procedure_namespace
    ON procedure_namespace.oid = procedure.pronamespace
  WHERE NOT trigger.tgisinternal
    AND namespace.nspname = 'public'
    AND relation.relname = 'posts'
    AND trigger.tgname = 'notify_post'
    AND procedure_namespace.nspname = 'supabase_functions'
    AND procedure.proname = 'http_request';

  IF source_definition IS NULL THEN
    RAISE EXCEPTION
      'Cannot create notify_event: source trigger public.posts.notify_post was not found';
  END IF;

  target_definition := replace(
    source_definition,
    'CREATE TRIGGER notify_post AFTER INSERT ON posts',
    'CREATE TRIGGER notify_event AFTER INSERT ON public.events'
  );

  IF target_definition = source_definition THEN
    RAISE EXCEPTION
      'Cannot create notify_event: unexpected notify_post trigger definition';
  END IF;

  DROP TRIGGER IF EXISTS notify_event ON public.events;
  EXECUTE target_definition;
END;
$migration$;
