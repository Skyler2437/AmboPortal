import { describe, it, expect, vi, beforeEach } from "vitest";

// Captures the payload passed to events.insert() so tests can assert its shape.
const { mockState, mockSupabaseClient } = vi.hoisted(() => {
  const mockState: {
    insertedPayload: Record<string, unknown> | null;
    insertError: { message: string } | null;
  } = { insertedPayload: null, insertError: null };

  const mockSupabaseClient = {
    from: vi.fn((table: string) => ({
      insert: vi.fn((payload: Record<string, unknown>) => {
        if (table === "events") mockState.insertedPayload = payload;
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
  getSession: vi.fn(async () => ({ userId: "admin-1", role: "superadmin" })),
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
    mockState.insertedPayload = null;
    mockState.insertError = null;
  });

  it("does not include a location key in the insert payload (column was dropped in 20260310_drop_events_location.sql)", async () => {
    const res = await POST(makeCreateRequest(validBody));

    expect(res.status).toBe(200);
    expect(mockState.insertedPayload).not.toBeNull();
    expect(Object.keys(mockState.insertedPayload!)).not.toContain("location");
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
