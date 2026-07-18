import { NextRequest, NextResponse } from "next/server";
import {
  consumeAuthorizationCode,
  createTokenPair,
  refreshTokenPair,
} from "@/lib/mcp/oauth-store";
import { getMcpResourceUrl, verifyPkceChallenge } from "@/lib/mcp/oauth-utils";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

export async function POST(req: NextRequest) {
  try {
    // OAuth token endpoint accepts application/x-www-form-urlencoded
    const contentType = req.headers.get("content-type") || "";
    let params: Record<string, string>;

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      params = Object.fromEntries(formData.entries()) as Record<string, string>;
    } else if (contentType.includes("application/json")) {
      params = await req.json();
    } else {
      // Try form data as default (OAuth spec standard)
      const formData = await req.formData();
      params = Object.fromEntries(formData.entries()) as Record<string, string>;
    }

    const grantType = params.grant_type;

    if (grantType === "authorization_code") {
      return handleAuthorizationCode(params);
    } else if (grantType === "refresh_token") {
      return handleRefreshToken(params);
    } else {
      return NextResponse.json(
        { error: "unsupported_grant_type", error_description: "Only authorization_code and refresh_token are supported" },
        { status: 400, headers: CORS_HEADERS }
      );
    }
  } catch (err) {
    console.error("OAuth token error:", err);
    return NextResponse.json(
      { error: "server_error", error_description: "Internal server error" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

async function handleAuthorizationCode(params: Record<string, string>) {
  const { code, client_id, redirect_uri, code_verifier, resource } = params;

  if (!code || !client_id || !redirect_uri || !code_verifier) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Missing required parameters: code, client_id, redirect_uri, code_verifier" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Consume the authorization code (validates expiry, single-use)
  const authCode = await consumeAuthorizationCode(code);
  if (!authCode) {
    return NextResponse.json(
      { error: "invalid_grant", error_description: "Authorization code is invalid, expired, or already used" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Validate client_id and redirect_uri match
  if (authCode.client_id !== client_id || authCode.redirect_uri !== redirect_uri) {
    return NextResponse.json(
      { error: "invalid_grant", error_description: "client_id or redirect_uri mismatch" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  if (resource !== getMcpResourceUrl() || authCode.resource !== resource) {
    return NextResponse.json(
      { error: "invalid_target", error_description: "The requested protected resource is invalid" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Verify PKCE challenge
  if (!verifyPkceChallenge(code_verifier, authCode.code_challenge)) {
    return NextResponse.json(
      { error: "invalid_grant", error_description: "PKCE code_verifier does not match code_challenge" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Issue tokens
  const tokens = await createTokenPair(authCode.client_id, authCode.user_id, authCode.scope, resource);

  return NextResponse.json(tokens, { headers: CORS_HEADERS });
}

async function handleRefreshToken(params: Record<string, string>) {
  const { refresh_token, client_id, resource } = params;

  if (!refresh_token || !client_id) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Missing required parameters: refresh_token, client_id" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  if (resource !== getMcpResourceUrl()) {
    return NextResponse.json(
      { error: "invalid_target", error_description: "The requested protected resource is invalid" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const tokens = await refreshTokenPair(refresh_token, client_id);
  if (!tokens) {
    return NextResponse.json(
      { error: "invalid_grant", error_description: "Refresh token is invalid, expired, or revoked" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  return NextResponse.json(tokens, { headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
