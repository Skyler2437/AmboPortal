import { describe, it, expect, vi } from "vitest";

// Mock next/headers (transitively imported by @/lib/session)
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

process.env.SESSION_SECRET = "test-secret-for-middleware-tests";

import { NextRequest } from "next/server";
import { createSession, COOKIE_NAME } from "@/lib/session";
import { middleware } from "@/middleware";

function buildRequest(pathname: string, token?: string): NextRequest {
  const req = new NextRequest(new URL(pathname, "http://localhost:3000"));
  if (token) req.cookies.set(COOKIE_NAME, token);
  return req;
}

describe("Middleware - Smoke / Route Protection @smoke", () => {
  it.each(['/api/posts', '/api/posts/uploads'])('lets %s validate mobile Bearer authentication in its handler', async path => {
    const response = await middleware(new NextRequest(`http://localhost:3000${path}`, {
      method: 'POST', headers: { Authorization: 'Bearer mobile-session' },
    }));
    expect(response.headers.get('location')).toBeNull();
    expect(response.status).toBe(200);
  });

  it("allows /login without a session (login page is reachable)", async () => {
    const res = await middleware(buildRequest("/login"));
    // NextResponse.next() — not a redirect
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("allows /api/auth/login without a session", async () => {
    const res = await middleware(buildRequest("/api/auth/login"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("allows /forgot-password without a session", async () => {
    const res = await middleware(buildRequest("/forgot-password"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects /admin to /login when no session", async () => {
    const res = await middleware(buildRequest("/admin"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("redirects /student to /login when no session", async () => {
    const res = await middleware(buildRequest("/student"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("allows /admin with a valid admin session", async () => {
    const token = await createSession({ userId: "admin-1", role: "admin" });
    const res = await middleware(buildRequest("/admin", token));
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("allows /admin with a superadmin session", async () => {
    const token = await createSession({ userId: "sa-1", role: "superadmin" });
    const res = await middleware(buildRequest("/admin", token));
    expect(res.headers.get("location")).toBeNull();
  });

  it("allows /student with a valid student session", async () => {
    const token = await createSession({ userId: "stu-1", role: "student" });
    const res = await middleware(buildRequest("/student", token));
    expect(res.headers.get("location")).toBeNull();
    expect(res.status).toBe(200);
  });

  it("redirects /admin to /student when user has student role", async () => {
    const token = await createSession({ userId: "stu-1", role: "student" });
    const res = await middleware(buildRequest("/admin", token));
    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).not.toBeNull();
    expect(new URL(location!).pathname).toBe("/student");
  });

  it("passes through public routes like / without redirect", async () => {
    const res = await middleware(buildRequest("/"));
    expect(res.headers.get("location")).toBeNull();
  });
});
