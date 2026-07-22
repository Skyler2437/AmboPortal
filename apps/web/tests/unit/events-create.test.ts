import { describe, it, expect, vi, beforeEach } from "vitest";

// Captures the payload passed to events.insert() so tests can assert its shape.
const { mockState, mockSupabaseClient } = vi.hoisted(() => {
  const mockState: {
    session: {
      userId: string;
      role: "basic" | "student" | "admin" | "superadmin" | "applicant";
    } | null;
    insertedPayload: Record<string, unknown> | null;
    insertError: { message: string } | null;
    eventInsertCount: number;
  } = {
    session: { userId: "admin-1", role: "superadmin" },
    insertedPayload: null,
    insertError: null,
    eventInsertCount: 0,
  };

  const mockSupabaseClient = {
    from: vi.fn((table: string) => ({
      insert: vi.fn((payload: Record<string, unknown>) => {
        if (table === "events") {
          mockState.insertedPayload = payload;
          mockState.eventInsertCount += 1;
        }
        return {
          select: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: mockState.insertError ? null : { id: "evt-1", ...payload },
              error: mockState.insertError,
            })),
          })),
        };
      }),
      update: vi.fn(() => ({
        eq: vi.fn(async () => ({ error: null })),
      })),
    })),
  };

  return { mockState, mockSupabaseClient };
});

vi.mock("@ambo/database/admin-client", () => ({
  createAdminClient: vi.fn(() => mockSupabaseClient),
  adminClient: mockSupabaseClient,
}));

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => mockState.session),
}));

vi.mock("@/lib/googleCalendar", () => ({
  createCalendarEvent: vi.fn(async () => null),
}));

import { POST } from "@/app/api/events/route";

function makeCreateRequest(body: Record<string, unknown>) {
  return new Request("http://localhost:3000/api/events", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const validBody = {
  title: "Fall Open House",
  description: "Tour night",
  start_time: "2026-08-01T17:00:00.000Z",
  end_time: "2026-08-01T19:00:00.000Z",
  uniform: "Ambassador Polo",
};

describe("POST /api/events (create)", () => {
  beforeEach(() => {
    mockState.session = { userId: "admin-1", role: "superadmin" };
    mockState.insertedPayload = null;
    mockState.insertError = null;
    mockState.eventInsertCount = 0;
  });

  it.each([
    ["student", "student-1"],
    ["admin", "admin-1"],
    ["superadmin", "superadmin-1"],
  ] as const)("immediately creates an event for an authenticated %s", async (role, userId) => {
    mockState.session = { userId, role };

    const res = await POST(makeCreateRequest(validBody));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      event: expect.objectContaining({ id: "evt-1", created_by: userId }),
    });
    expect(mockState.eventInsertCount).toBe(1);
  });

  it.each([
    [null, 401, "Unauthorized"],
    [{ userId: "applicant-1", role: "applicant" } as const, 403, "Forbidden"],
    [{ userId: "basic-1", role: "basic" } as const, 403, "Forbidden"],
  ])("rejects a non-creator session %# before inserting", async (session, status, error) => {
    mockState.session = session;

    const res = await POST(makeCreateRequest(validBody));

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
    expect(mockState.eventInsertCount).toBe(0);
  });

  it("binds created_by to the authenticated session instead of client input", async () => {
    mockState.session = { userId: "student-1", role: "student" };

    const res = await POST(makeCreateRequest({
      ...validBody,
      created_by: "attacker-selected-owner",
    }));

    expect(res.status).toBe(200);
    expect(mockState.insertedPayload?.created_by).toBe("student-1");
    expect(mockState.insertedPayload?.created_by).not.toBe("attacker-selected-owner");
  });

  it("does not include a location key in the insert payload (column was dropped in 20260310_drop_events_location.sql)", async () => {
    const res = await POST(makeCreateRequest(validBody));

    expect(res.status).toBe(200);
    expect(mockState.insertedPayload).not.toBeNull();
    expect(Object.keys(mockState.insertedPayload!)).not.toContain("location");
  });

  it("uses the standard uniform when omitted", async () => {
    const { uniform: _uniform, ...withoutUniform } = validBody;

    const res = await POST(makeCreateRequest(withoutUniform));

    expect(res.status).toBe(200);
    expect(mockState.insertedPayload?.uniform).toBe(
      "Ambo polo with khaki or navy pants/shorts (appropriate length)."
    );
  });

  it("returns 400 and logs the underlying error when the insert fails", async () => {
    mockState.insertError = { message: "column events.location does not exist" };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(makeCreateRequest(validBody));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Request failed");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[events]"),
      expect.objectContaining({ message: "column events.location does not exist" })
    );

    errorSpy.mockRestore();
  });
});
