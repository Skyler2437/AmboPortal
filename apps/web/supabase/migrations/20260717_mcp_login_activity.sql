-- Login activity used by the admin MCP tools.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_last_login_at
  ON public.users (last_login_at DESC)
  WHERE last_login_at IS NOT NULL;
