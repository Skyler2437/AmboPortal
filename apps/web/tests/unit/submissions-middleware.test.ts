import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/session", () => ({ COOKIE_NAME: "ambo_session", verifySessionToken: vi.fn(async () => null) }));
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
describe("submission middleware authentication", () => {
  it.each([undefined, "expired-token"])("returns JSON 401 without redirect for %s", async token => {
    const req = new NextRequest("http://localhost/api/submissions", { method: "POST" });
    if (token) req.cookies.set("ambo_session", token);
    const res = await middleware(req); expect(res.status).toBe(401); expect(res.headers.get("location")).toBeNull(); expect((await res.json()).error).toContain("sign in");
  });
});
