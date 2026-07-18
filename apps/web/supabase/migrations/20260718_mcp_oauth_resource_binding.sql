-- Bind MCP authorization codes and tokens to their intended protected resource.
ALTER TABLE oauth_authorization_codes
  ADD COLUMN IF NOT EXISTS resource TEXT;

ALTER TABLE oauth_tokens
  ADD COLUMN IF NOT EXISTS resource TEXT;
