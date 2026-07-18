import { randomBytes, createHash } from "crypto";

/**
 * Generate a cryptographically random opaque token (48 bytes = 96 hex chars).
 */
export function generateToken(): string {
  return randomBytes(48).toString("hex");
}

/**
 * Verify a PKCE S256 code challenge.
 * @param codeVerifier - The original code_verifier from the token request
 * @param codeChallenge - The stored code_challenge from the authorization request
 * @returns true if the verifier matches the challenge
 */
export function verifyPkceChallenge(
  codeVerifier: string,
  codeChallenge: string
): boolean {
  const hash = createHash("sha256").update(codeVerifier).digest("base64url");
  return hash === codeChallenge;
}

/**
 * Get the app's base URL from environment or request headers.
 */
export function getBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (url) return url.replace(/\/$/, "");
  // Fallback for local development
  const port = process.env.PORT || "3000";
  return `http://localhost:${port}`;
}

export function getMcpResourceUrl(): string {
  return `${getBaseUrl()}/api/mcp/mcp`;
}

/**
 * Build OAuth 2.0 Authorization Server Metadata (RFC 8414).
 */
export function buildAuthServerMetadata(baseUrl: string) {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    registration_endpoint: `${baseUrl}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["read", "write"],
  };
}
