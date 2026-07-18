import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  createAuthorizationCode: vi.fn(),
  consumeAuthorizationCode: vi.fn(),
  createTokenPair: vi.fn(),
  refreshTokenPair: vi.fn(),
}));

vi.mock("@/lib/mcp/oauth-store", () => ({
  getClient: vi.fn(async () => ({
    client_id: "chatgpt-client",
    client_name: "ChatGPT",
    redirect_uris: ["https://chatgpt.com/connector/oauth/test"],
  })),
  createAuthorizationCode: mocks.createAuthorizationCode,
  consumeAuthorizationCode: mocks.consumeAuthorizationCode,
  createTokenPair: mocks.createTokenPair,
  refreshTokenPair: mocks.refreshTokenPair,
}));

vi.mock("@ambo/database/admin-client", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: { id: "user-1", role: "student", password_hash: "hash" },
            error: null,
          })),
        })),
      })),
      update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
    })),
  })),
}));

vi.mock("bcryptjs", () => ({ default: { compare: vi.fn(async () => true) } }));

import { GET as getProtectedResource } from "@/app/.well-known/oauth-protected-resource/route";
import { GET as getAuthorize, POST as postAuthorize } from "@/app/oauth/authorize/route";
import { POST as postToken } from "@/app/oauth/token/route";

const baseUrl = "https://lcsambos.vercel.app";
const resource = `${baseUrl}/api/mcp/mcp`;
const redirectUri = "https://chatgpt.com/connector/oauth/test";

describe("ChatGPT MCP OAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_APP_URL = baseUrl;
    mocks.createAuthorizationCode.mockResolvedValue("auth-code");
    mocks.consumeAuthorizationCode.mockResolvedValue({
      client_id: "chatgpt-client",
      user_id: "user-1",
      redirect_uri: redirectUri,
      code_challenge: "challenge",
      scope: "read write",
      resource,
    });
    mocks.createTokenPair.mockResolvedValue({
      access_token: "access-token",
      refresh_token: "refresh-token",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "read write",
    });
    mocks.refreshTokenPair.mockResolvedValue({
      access_token: "rotated-access-token",
      refresh_token: "rotated-refresh-token",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "read write",
    });
  });

  it("advertises the exact MCP endpoint as its protected resource", async () => {
    const response = await getProtectedResource();

    expect(await response.json()).toMatchObject({ resource });
  });

  it("preserves the resource parameter in the authorization form", async () => {
    const url = new URL(`${baseUrl}/authorize`);
    url.searchParams.set("client_id", "chatgpt-client");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("code_challenge", "challenge");
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("resource", resource);

    const response = await getAuthorize(new NextRequest(url));
    const html = await response.text();

    expect(html).toContain(`name="resource" value="${resource}"`);
    expect(html).toContain("Connect your account to use with ChatGPT");
  });

  it("stores the resource with the authorization code", async () => {
    const body = new URLSearchParams({
      email: "student@example.com",
      password: "password",
      client_id: "chatgpt-client",
      redirect_uri: redirectUri,
      state: "state",
      code_challenge: "challenge",
      scope: "read write",
      resource,
    });

    const response = await postAuthorize(new NextRequest(`${baseUrl}/oauth/authorize`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }));

    expect(response.status).toBe(303);
    expect(mocks.createAuthorizationCode).toHaveBeenCalledWith(expect.objectContaining({ resource }));
  });

  it("rejects a token exchange for a different protected resource", async () => {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: "auth-code",
      client_id: "chatgpt-client",
      redirect_uri: redirectUri,
      code_verifier: "verifier",
      resource: `${baseUrl}/api/mcp/other`,
    });

    const response = await postToken(new NextRequest(`${baseUrl}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_target" });
    expect(mocks.createTokenPair).not.toHaveBeenCalled();
  });

  it("requires the protected resource when refreshing a token", async () => {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: "refresh-token",
      client_id: "chatgpt-client",
      resource: `${baseUrl}/api/mcp/other`,
    });

    const response = await postToken(new NextRequest(`${baseUrl}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_target" });
    expect(mocks.refreshTokenPair).not.toHaveBeenCalled();
  });
});
