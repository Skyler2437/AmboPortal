import { createAdminClient } from "@ambo/database/admin-client";
import { generateToken } from "./oauth-utils";

const ACCESS_TOKEN_TTL_SECONDS = 3600; // 1 hour
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const AUTH_CODE_TTL_SECONDS = 600; // 10 minutes

// ─── Client Registration ──────────────────────────────────────

export async function registerClient(
  clientName: string,
  redirectUris: string[]
): Promise<{ client_id: string; client_name: string; redirect_uris: string[] }> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("oauth_clients")
    .insert({ client_name: clientName, redirect_uris: redirectUris })
    .select("client_id, client_name, redirect_uris")
    .single();

  if (error) throw new Error(`Failed to register client: ${error.message}`);
  return data;
}

export async function getClient(clientId: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("oauth_clients")
    .select("client_id, client_name, redirect_uris")
    .eq("client_id", clientId)
    .single();

  if (error) return null;
  return data as { client_id: string; client_name: string; redirect_uris: string[] };
}

// ─── Authorization Codes ──────────────────────────────────────

export async function createAuthorizationCode(params: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string;
}): Promise<string> {
  const supabase = createAdminClient();
  const code = generateToken();
  const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000).toISOString();

  const { error } = await supabase.from("oauth_authorization_codes").insert({
    code,
    client_id: params.clientId,
    user_id: params.userId,
    redirect_uri: params.redirectUri,
    code_challenge: params.codeChallenge,
    scope: params.scope,
    resource: params.resource,
    expires_at: expiresAt,
  });

  if (error) throw new Error(`Failed to create authorization code: ${error.message}`);
  return code;
}

export async function consumeAuthorizationCode(code: string) {
  const supabase = createAdminClient();

  // Fetch the code
  const { data, error } = await supabase
    .from("oauth_authorization_codes")
    .select("*")
    .eq("code", code)
    .single();

  if (error || !data) return null;

  // Check if already used
  if (data.used) return null;

  // Check if expired
  if (new Date(data.expires_at) < new Date()) return null;

  // Mark as used
  await supabase
    .from("oauth_authorization_codes")
    .update({ used: true })
    .eq("code", code);

  return data as {
    code: string;
    client_id: string;
    user_id: string;
    redirect_uri: string;
    code_challenge: string;
    scope: string;
    resource: string;
  };
}

// ─── Token Management ─────────────────────────────────────────

export async function createTokenPair(
  clientId: string,
  userId: string,
  scope: string,
  resource: string
): Promise<{
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}> {
  const supabase = createAdminClient();
  const accessToken = generateToken();
  const refreshToken = generateToken();
  const now = new Date();

  const { error } = await supabase.from("oauth_tokens").insert({
    access_token: accessToken,
    refresh_token: refreshToken,
    client_id: clientId,
    user_id: userId,
    scope,
    resource,
    access_token_expires_at: new Date(now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
    refresh_token_expires_at: new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
  });

  if (error) throw new Error(`Failed to create token pair: ${error.message}`);

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope,
  };
}

export async function validateAccessToken(
  token: string,
  resource?: string
): Promise<{ userId: string; role: string; scope: string; clientId: string } | null> {
  const supabase = createAdminClient();

  // Look up token and join with users to get current role
  const { data, error } = await supabase
    .from("oauth_tokens")
    .select("user_id, client_id, scope, resource, access_token_expires_at, revoked")
    .eq("access_token", token)
    .single();

  if (error || !data) return null;
  if (data.revoked) return null;
  if (new Date(data.access_token_expires_at) < new Date()) return null;
  if (resource && data.resource !== resource) return null;

  // Fetch current role from users table (not stale token data)
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("role")
    .eq("id", data.user_id)
    .single();

  if (userError || !user) return null;

  return {
    userId: data.user_id,
    role: user.role,
    scope: data.scope,
    clientId: data.client_id,
  };
}

export async function refreshTokenPair(
  refreshToken: string,
  clientId: string
): Promise<{
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
} | null> {
  const supabase = createAdminClient();

  // Look up refresh token
  const { data, error } = await supabase
    .from("oauth_tokens")
    .select("id, user_id, client_id, scope, resource, refresh_token_expires_at, revoked")
    .eq("refresh_token", refreshToken)
    .single();

  if (error || !data) return null;
  if (data.revoked) return null;
  if (data.client_id !== clientId) return null;
  if (new Date(data.refresh_token_expires_at) < new Date()) return null;

  // Revoke old token pair
  await supabase.from("oauth_tokens").update({ revoked: true }).eq("id", data.id);

  // Create new token pair
  return createTokenPair(data.client_id, data.user_id, data.scope, data.resource);
}
