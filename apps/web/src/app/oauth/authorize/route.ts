import { NextRequest } from "next/server";
import { createAdminClient } from "@ambo/database/admin-client";
import bcrypt from "bcryptjs";
import { getClient, createAuthorizationCode } from "@/lib/mcp/oauth-store";
import { getBaseUrl } from "@/lib/mcp/oauth-utils";

/**
 * GET /oauth/authorize — Renders a standalone HTML login form for the OAuth flow.
 * This page is shown in Claude.ai's OAuth popup window.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const clientId = params.get("client_id") || "";
  const redirectUri = params.get("redirect_uri") || "";
  const state = params.get("state") || "";
  const codeChallenge = params.get("code_challenge") || "";
  const codeChallengeMethod = params.get("code_challenge_method") || "";
  const scope = params.get("scope") || "read write";

  // Validate required params
  const errors: string[] = [];
  if (!clientId) errors.push("client_id is required");
  if (!redirectUri) errors.push("redirect_uri is required");
  if (!codeChallenge) errors.push("code_challenge is required");
  if (codeChallengeMethod && codeChallengeMethod !== "S256") {
    errors.push("Only S256 code_challenge_method is supported");
  }

  // Validate client exists and redirect_uri matches
  if (clientId && redirectUri) {
    const client = await getClient(clientId);
    if (!client) {
      errors.push("Unknown client_id");
    } else if (!client.redirect_uris.includes(redirectUri)) {
      errors.push("redirect_uri does not match registered URIs");
    }
  }

  const errorHtml = errors.length > 0
    ? `<div style="color:#dc2626;margin-bottom:16px;padding:12px;background:#fef2f2;border-radius:8px">${errors.join("<br>")}</div>`
    : "";

  const baseUrl = getBaseUrl();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ambassador Portal — Sign In</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; background: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 32px; max-width: 400px; width: 100%; }
    h1 { font-size: 20px; font-weight: 600; color: #0f172a; margin-bottom: 4px; }
    .subtitle { color: #64748b; font-size: 14px; margin-bottom: 24px; }
    label { display: block; font-size: 14px; font-weight: 500; color: #334155; margin-bottom: 6px; }
    input { width: 100%; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; outline: none; transition: border 0.15s; }
    input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
    .field { margin-bottom: 16px; }
    button { width: 100%; padding: 10px; background: #1e40af; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: background 0.15s; }
    button:hover { background: #1e3a8a; }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .error { color: #dc2626; margin-bottom: 16px; padding: 12px; background: #fef2f2; border-radius: 8px; font-size: 13px; }
    .logo { text-align: center; margin-bottom: 20px; }
    .logo img { height: 48px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo"><img src="${baseUrl}/logo.png" alt="Ambassador Portal" onerror="this.style.display='none'"></div>
    <h1>Sign in to Ambassador Portal</h1>
    <p class="subtitle">Connect your account to use with Claude AI</p>
    ${errorHtml}
    ${errors.length === 0 ? `
    <form method="POST" action="/oauth/authorize" id="loginForm">
      <input type="hidden" name="client_id" value="${escapeHtml(clientId)}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}">
      <input type="hidden" name="state" value="${escapeHtml(state)}">
      <input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}">
      <input type="hidden" name="scope" value="${escapeHtml(scope)}">
      <div class="field">
        <label for="email">Email or Phone</label>
        <input type="text" id="email" name="email" required autocomplete="username" placeholder="you@example.com">
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required autocomplete="current-password" placeholder="Enter your password">
      </div>
      <button type="submit">Sign In &amp; Authorize</button>
    </form>
    ` : ""}
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/**
 * POST /oauth/authorize — Handle login form submission.
 * Validates credentials, creates auth code, redirects back to client.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const email = (formData.get("email") as string)?.trim().toLowerCase();
    const password = formData.get("password") as string;
    const clientId = formData.get("client_id") as string;
    const redirectUri = formData.get("redirect_uri") as string;
    const state = formData.get("state") as string;
    const codeChallenge = formData.get("code_challenge") as string;
    const scope = (formData.get("scope") as string) || "read write";

    if (!email || !password || !clientId || !redirectUri || !codeChallenge) {
      return redirectWithError(redirectUri, state, "invalid_request", "Missing required parameters");
    }

    // Validate client
    const client = await getClient(clientId);
    if (!client || !client.redirect_uris.includes(redirectUri)) {
      return new Response("Invalid client or redirect URI", { status: 400 });
    }

    // Look up user by email or phone
    const supabase = createAdminClient();
    let query = supabase.from("users").select("id, role, password_hash");
    if (/^\d{10}$/.test(email)) {
      query = query.eq("phone", email);
    } else {
      query = query.eq("email", email);
    }

    const { data: user, error: lookupError } = await query.single();

    if (lookupError || !user || !user.password_hash) {
      return renderError(req, "Invalid email or password.", { clientId, redirectUri, state, codeChallenge, scope });
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return renderError(req, "Invalid email or password.", { clientId, redirectUri, state, codeChallenge, scope });
    }

    try {
      await supabase
        .from("users")
        .update({ last_login_at: new Date().toISOString() })
        .eq("id", user.id);
    } catch (activityError) {
      console.error("Failed to record login activity:", activityError);
    }

    // Create authorization code
    const code = await createAuthorizationCode({
      clientId,
      userId: user.id,
      redirectUri,
      codeChallenge,
      scope,
    });

    // Redirect back to client with code.
    // Use 303 See Other (correct for POST→GET redirect) with explicit
    // headers. Claude.ai monitors the popup/tab URL for the callback
    // pattern, so we must use a real HTTP redirect — not an HTML page.
    const redirectUrl = new URL(redirectUri);
    redirectUrl.searchParams.set("code", code);
    if (state) redirectUrl.searchParams.set("state", state);

    return new Response(null, {
      status: 303,
      headers: {
        Location: redirectUrl.toString(),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("OAuth authorize error:", err);
    return new Response("Internal server error", { status: 500 });
  }
}

function redirectWithError(
  redirectUri: string,
  state: string,
  errorCode: string,
  description: string
) {
  if (!redirectUri) return new Response(description, { status: 400 });
  const url = new URL(redirectUri);
  url.searchParams.set("error", errorCode);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  return new Response(null, {
    status: 303,
    headers: { Location: url.toString(), "Cache-Control": "no-store" },
  });
}

function renderError(
  _req: NextRequest,
  message: string,
  params: { clientId: string; redirectUri: string; state: string; codeChallenge: string; scope: string }
) {
  const baseUrl = getBaseUrl();
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ambassador Portal — Sign In</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; background: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 32px; max-width: 400px; width: 100%; }
    h1 { font-size: 20px; font-weight: 600; color: #0f172a; margin-bottom: 4px; }
    .subtitle { color: #64748b; font-size: 14px; margin-bottom: 24px; }
    label { display: block; font-size: 14px; font-weight: 500; color: #334155; margin-bottom: 6px; }
    input { width: 100%; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; outline: none; }
    input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
    .field { margin-bottom: 16px; }
    button { width: 100%; padding: 10px; background: #1e40af; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; }
    button:hover { background: #1e3a8a; }
    .error { color: #dc2626; margin-bottom: 16px; padding: 12px; background: #fef2f2; border-radius: 8px; font-size: 13px; }
    .logo { text-align: center; margin-bottom: 20px; }
    .logo img { height: 48px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo"><img src="${baseUrl}/logo.png" alt="Ambassador Portal" onerror="this.style.display='none'"></div>
    <h1>Sign in to Ambassador Portal</h1>
    <p class="subtitle">Connect your account to use with Claude AI</p>
    <div class="error">${escapeHtml(message)}</div>
    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="client_id" value="${escapeHtml(params.clientId)}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirectUri)}">
      <input type="hidden" name="state" value="${escapeHtml(params.state)}">
      <input type="hidden" name="code_challenge" value="${escapeHtml(params.codeChallenge)}">
      <input type="hidden" name="scope" value="${escapeHtml(params.scope)}">
      <div class="field">
        <label for="email">Email or Phone</label>
        <input type="text" id="email" name="email" required autocomplete="username" placeholder="you@example.com">
      </div>
      <div class="field">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required autocomplete="current-password" placeholder="Enter your password">
      </div>
      <button type="submit">Sign In &amp; Authorize</button>
    </form>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
