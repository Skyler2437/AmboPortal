import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: { userId: "11111111-1111-4111-8111-111111111111", role: "student" } as { userId: string; role: string } | null,
  result: { data: { id: "saved-id" }, error: null } as { data: { id: string } | null; error: { message: string } | null },
  insert: vi.fn(),
}));
vi.mock("@/lib/session", () => ({ getSession: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })), getRateLimitKey: vi.fn(() => "test") }));
vi.mock("@ambo/database/admin-client", () => ({ createAdminClient: () => ({ from: () => ({ insert: (payload: unknown) => {
  mocks.insert(payload); return { select: () => ({ single: async () => mocks.result }) };
} }) }) }));
import { POST } from "@/app/api/submissions/route";
import { submissionSchema } from "@/lib/validations";
import { confirmSubmissionResponse, emptySubmissionForm, schoolServiceDate } from "@/lib/submissionForm";
import { SERVICE_TYPES } from "@ambo/database/types";
const valid = { user_id: "11111111-1111-4111-8111-111111111111", service_type: "Other", service_date: "2026-01-02", hours: 1.25, credits: 0, feedback: "Volunteered at the library" };
const request = (body: unknown) => new Request("http://localhost/api/submissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { mocks.session = { userId: valid.user_id, role: "student" }; mocks.result = { data: { id: "saved-id" }, error: null }; mocks.insert.mockClear(); });
describe("service hour validation", () => {
  it("accepts every selectable service type including Other", () => {
    expect(SERVICE_TYPES).toContain("Other");
    for (const service_type of SERVICE_TYPES) expect(submissionSchema.safeParse({ ...valid, service_type }).success).toBe(true);
  });
  it("rejects arbitrary titles but allows their details in Other notes", () => {
    expect(submissionSchema.safeParse({ ...valid, service_type: "Library volunteer" }).success).toBe(false);
    expect(submissionSchema.safeParse({ ...valid, feedback: "Library volunteer" }).success).toBe(true);
  });
  it.each([0.1, 0.25, 1.33, 24])("accepts fractional hours %s", hours => { expect(submissionSchema.safeParse({ ...valid, hours }).success).toBe(true); });
  it.each([NaN, Infinity, -Infinity, -1, 0, 24.1, "1.25junk", ""])("rejects invalid hours %s", hours => { expect(submissionSchema.safeParse({ ...valid, hours }).success).toBe(false); });
  it.each([NaN, Infinity, -Infinity, -1, 1.5, "1junk"])("rejects invalid credits %s", credits => { expect(submissionSchema.safeParse({ ...valid, credits }).success).toBe(false); });
  it.each(["2026-02-30", "2025-02-29", "not-a-date", "2026-1-2", "2026-01-02T00:00:00Z", "2999-01-01"])("rejects invalid or future date %s", service_date => { expect(submissionSchema.safeParse({ ...valid, service_date }).success).toBe(false); });
  it("uses the school calendar date around UTC midnight", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-13T01:00:00Z"));
    expect(submissionSchema.safeParse({ ...valid, service_date: "2026-09-12" }).success).toBe(true);
    expect(submissionSchema.safeParse({ ...valid, service_date: "2026-09-13" }).success).toBe(false);
    vi.useRealTimers();
  });
  it("keeps default and validation on the same Pacific date before UTC dawn", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-12T05:00:00Z"));
      expect(schoolServiceDate()).toBe("2026-09-11");
      expect(emptySubmissionForm().service_date).toBe("2026-09-11");
      expect(submissionSchema.safeParse({ ...valid, service_date: emptySubmissionForm().service_date }).success).toBe(true);
      expect(submissionSchema.safeParse({ ...valid, service_date: "2026-09-12" }).success).toBe(false);
      expect(submissionSchema.safeParse({ ...valid, service_date: "2000-02-29" }).success).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it("defaults credits to zero and uses the school calendar", () => {
    expect(emptySubmissionForm().tour_credits).toBe("0");
    expect(schoolServiceDate(new Date("2026-09-12T23:59:00-07:00"))).toBe("2026-09-12");
  });
});
describe("POST service hours", () => {
  it("confirms the persisted id and keeps fractional hours", async () => {
    const res = await POST(request(valid)); expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: "saved-id" }); expect(mocks.insert).toHaveBeenCalledWith(valid);
  });
  it("rejects an absent session before inserting", async () => { mocks.session = null; expect((await POST(request(valid))).status).toBe(401); expect(mocks.insert).not.toHaveBeenCalled(); });
  it.each(["admin", "superadmin", "applicant", "basic"])("rejects %s roles", async role => { mocks.session!.role = role; expect((await POST(request(valid))).status).toBe(403); expect(mocks.insert).not.toHaveBeenCalled(); });
  it("rejects a different owner", async () => { expect((await POST(request({ ...valid, user_id: "22222222-2222-4222-8222-222222222222" }))).status).toBe(403); expect(mocks.insert).not.toHaveBeenCalled(); });
  it("returns actionable validation errors", async () => {
    const res = await POST(request({ ...valid, hours: 25 })); expect(res.status).toBe(400); expect((await res.json()).error).toContain("24"); expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("handles malformed JSON", async () => { const res = await POST(new Request("http://localhost/api/submissions", { method: "POST", body: "{" })); expect(res.status).toBe(400); expect(mocks.insert).not.toHaveBeenCalled(); });
  it.each([{ data: null, error: { message: "failed" } }, { data: null, error: null }])("never confirms failed or missing insert results", async result => {
    mocks.result = result; const res = await POST(request(valid)); expect(res.status).toBe(500); expect(await res.json()).not.toHaveProperty("ok", true);
  });
});
describe("client submission confirmation", () => {
  it("accepts only confirmed persistence", async () => { await expect(confirmSubmissionResponse(Response.json({ ok: true, id: "saved-id" }))).resolves.toBeUndefined(); });
  it.each([{ ok: true }, {}, { ok: true, id: "" }, { ok: false, id: "id" }])("rejects missing evidence %#", async body => { await expect(confirmSubmissionResponse(Response.json(body))).rejects.toThrow("did not confirm"); });
  it("rejects a login page with status 200", async () => { await expect(confirmSubmissionResponse(new Response("<html>Login</html>"))).rejects.toThrow("did not confirm"); });
  it("rejects successful redirects", async () => { const res = Response.json({ ok: true, id: "id" }); Object.defineProperty(res, "redirected", { value: true }); await expect(confirmSubmissionResponse(res)).rejects.toThrow("session expired"); });
  it("explains expired sessions", async () => { await expect(confirmSubmissionResponse(Response.json({ error: "Unauthorized" }, { status: 401 }))).rejects.toThrow("entries have been kept"); });
  it("preserves meaningful server errors", async () => { await expect(confirmSubmissionResponse(Response.json({ error: "Hours cannot exceed 24" }, { status: 400 }))).rejects.toThrow("Hours cannot exceed 24"); });
});
