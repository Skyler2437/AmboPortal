import { type NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/session";

// Routes that never require authentication
const PUBLIC_PATHS = [
  "/api/auth/",
  "/api/mobile/",
  "/api/community/", // Community endpoints verify cookie or Bearer authentication themselves
  "/auth/callback",
  "/forgot-password",
  "/reset-password",
  "/privacy",
  "/terms",
  "/support",
  "/api/events/", // Event API routes handle their own auth (supports Bearer tokens from mobile)
  "/api/health",
  "/api/calendar/", // Public iCal feed for calendar subscriptions
  "/api/applications", // Guest application flow (used by mobile app)
  "/oauth/", // OAuth endpoints handle their own auth
  "/api/mcp/", // MCP server uses Bearer token auth
  "/api/webhooks/", // Supabase Database Webhooks (authenticated via x-webhook-secret header)
  "/.well-known/", // OAuth metadata discovery
  "/authorize", // Root-level OAuth authorize (Claude.ai compat)
  "/token", // Root-level OAuth token (Claude.ai compat)
];

function roleHome(role: string): string {
  switch (role) {
    case "basic":
      return "/apply";
    case "applicant":
      return "/status";
    case "admin":
    case "superadmin":
      return "/admin";
    default:
      return "/student";
  }
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Rewrite POST /register to /oauth/register for MCP OAuth compatibility.
  // Claude.ai ignores OAuth metadata and hits /register directly.
  // The /register page.tsx still serves browser GET requests normally.
  if (path === "/register" && request.method === "POST") {
    return NextResponse.rewrite(new URL("/oauth/register", request.url));
  }

  // Always allow API auth routes, public callback routes, and the root page
  // (the root page handles Supabase auth redirects for password reset flows)
  if (PUBLIC_PATHS.some((p) => path.startsWith(p)) || path === "/") {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  // ──────────────────────────────────────────
  // Guest pages: login and register
  // If already authenticated → redirect to their home
  // ──────────────────────────────────────────
  if (path.startsWith("/login") || path.startsWith("/register")) {
    if (session) {
      return NextResponse.redirect(new URL(roleHome(session.role), request.url));
    }
    return NextResponse.next();
  }

  // ──────────────────────────────────────────
  // Everything below requires a session
  // ──────────────────────────────────────────
  if (!session) {
    if (path === "/api/submissions") {
      return NextResponse.json({ error: "Your session expired. Please sign in again before submitting." }, { status: 401 });
    }
    // /apply is accessible to both guests (public application) and logged-in basic users
    if (path.startsWith("/apply")) {
      return NextResponse.next();
    }
    const loginUrl = new URL("/login", request.url);
    if (token) {
      loginUrl.searchParams.set("reason", "expired");
    }
    return NextResponse.redirect(loginUrl);
  }

  // ──────────────────────────────────────────
  // Role-based access enforcement
  // ──────────────────────────────────────────
  const { role } = session;

  // basic → can only access /apply
  if (role === "basic") {
    if (!path.startsWith("/apply") && !path.startsWith("/api/")) {
      return NextResponse.redirect(new URL("/apply", request.url));
    }
    return NextResponse.next();
  }

  // applicant → can only access /status
  if (role === "applicant") {
    if (!path.startsWith("/status") && !path.startsWith("/api/")) {
      return NextResponse.redirect(new URL("/status", request.url));
    }
    return NextResponse.next();
  }

  // admin/superadmin → full access
  if (role === "admin" || role === "superadmin") {
    return NextResponse.next();
  }

  // student → can access /student and /apply, but not /admin
  if (path.startsWith("/admin")) {
    return NextResponse.redirect(new URL("/student", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js|woff|woff2|ttf|eot|ico)$).*)",
  ],
};
