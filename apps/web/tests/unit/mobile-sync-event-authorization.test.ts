import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const VALID_EVENT_ID = "550e8400-e29b-41d4-a716-446655440000";

const mocks = vi.hoisted(() => ({
  authenticatedUserId: "owner" as string | null,
  roleResult: {
    data: { role: "student" } as { role: string } | null,
    error: null as { code?: string; message: string } | null,
  },
  ownership: {
    data: { id: "550e8400-e29b-41d4-a716-446655440000", created_by: "owner" } as {
      id: string;
      created_by: string | null;
    } | null,
    error: null as { code?: string; message: string } | null,
  },
  event: {
    id: "550e8400-e29b-41d4-a716-446655440000",
    title: "Fall Open House",
    description: "Tour night",
    start_time: "2026-08-01T17:00:00.000Z",
    end_time: "2026-08-01T19:00:00.000Z",
    type: "tour",
    uniform: "Ambassador Polo",
    google_calendar_event_id: null as string | null,
  },
  eventResult: {
    data: null as Record<string, unknown> | null,
    error: null as { code?: string; message: string } | null,
  },
  from: vi.fn(),
  update: vi.fn(),
  createCalendarEvent: vi.fn(),
  syncEventToGoogle: vi.fn(),
  roleSingle: vi.fn(),
  roleMaybeSingle: vi.fn(),
  fullEventSingle: vi.fn(),
  fullEventMaybeSingle: vi.fn(),
}));

const authClient = {
  auth: {
    getUser: vi.fn(async () => ({
      data: {
        user: mocks.authenticatedUserId
          ? { id: mocks.authenticatedUserId }
          : null,
      },
      error: null,
    })),
  },
};

const adminClient = { from: mocks.from };

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => authClient),
}));

vi.mock("@ambo/database/admin-client", () => ({
  createAdminClient: vi.fn(() => adminClient),
}));

vi.mock("@/lib/googleCalendar", () => ({
  createCalendarEvent: mocks.createCalendarEvent,
  syncEventToGoogle: mocks.syncEventToGoogle,
}));

import { POST } from "@/app/api/mobile/sync-event/route";

function request(eventId: unknown) {
  return new NextRequest("http://localhost:3000/api/mobile/sync-event", {
    method: "POST",
    body: JSON.stringify({ eventId }),
    headers: {
      Authorization: "Bearer valid-token",
      "Content-Type": "application/json",
    },
  });
}

describe("POST /api/mobile/sync-event authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    mocks.authenticatedUserId = "owner";
    mocks.roleResult = { data: { role: "student" }, error: null };
    mocks.ownership = {
      data: { id: VALID_EVENT_ID, created_by: "owner" },
      error: null,
    };
    mocks.event.google_calendar_event_id = null;
    mocks.eventResult = { data: mocks.event, error: null };
    mocks.createCalendarEvent.mockResolvedValue("google-event-1");
    mocks.roleSingle.mockImplementation(async () => mocks.roleResult);
    mocks.roleMaybeSingle.mockImplementation(async () => mocks.roleResult);
    mocks.fullEventSingle.mockImplementation(async () => mocks.eventResult);
    mocks.fullEventMaybeSingle.mockImplementation(async () => mocks.eventResult);
    mocks.update.mockReturnValue({
      eq: vi.fn(async () => ({ error: null })),
    });
    mocks.from.mockImplementation((table: string) => {
      if (table === "users") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: mocks.roleSingle,
              maybeSingle: mocks.roleMaybeSingle,
            })),
          })),
        };
      }
      expect(table).toBe("events");
      return {
        select: vi.fn((columns: string) => ({
          eq: vi.fn(() => {
            if (columns === "id, created_by" || columns === "created_by") {
              return {
                maybeSingle: vi.fn(async () => mocks.ownership),
              };
            }
            return {
              single: mocks.fullEventSingle,
              maybeSingle: mocks.fullEventMaybeSingle,
            };
          }),
        })),
        update: mocks.update,
      };
    });
  });

  it.each([undefined, null, "", "not-a-uuid", 123])(
    "returns 400 for invalid eventId %j before database queries",
    async (eventId) => {
      const response = await POST(request(eventId));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid eventId" });
      expect(mocks.from).not.toHaveBeenCalled();
    },
  );

  it("maps an ownership lookup failure to 500", async () => {
    mocks.ownership = {
      data: null,
      error: { code: "08006", message: "database unavailable" },
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(request(VALID_EVENT_ID));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Request failed" });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("ownership"),
      expect.objectContaining({ code: "08006", message: "database unavailable" }),
    );
    expect(mocks.createCalendarEvent).not.toHaveBeenCalled();
    expect(mocks.syncEventToGoogle).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("maps a role lookup failure to 500 before calendar or persistence side effects", async () => {
    mocks.roleResult = {
      data: null,
      error: { code: "08006", message: "database unavailable" },
    };

    const response = await POST(request(VALID_EVENT_ID));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Request failed" });
    expect(mocks.createCalendarEvent).not.toHaveBeenCalled();
    expect(mocks.syncEventToGoogle).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("uses zero-or-one semantics and forbids a missing user profile before side effects", async () => {
    mocks.roleResult = { data: null, error: null };

    const response = await POST(request(VALID_EVENT_ID));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(mocks.roleMaybeSingle).toHaveBeenCalledOnce();
    expect(mocks.roleSingle).not.toHaveBeenCalled();
    expect(mocks.createCalendarEvent).not.toHaveBeenCalled();
    expect(mocks.syncEventToGoogle).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("maps a successful zero-row ownership lookup to 404", async () => {
    mocks.ownership = { data: null, error: null };

    const response = await POST(request(VALID_EVENT_ID));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Event not found" });
    expect(mocks.createCalendarEvent).not.toHaveBeenCalled();
    expect(mocks.syncEventToGoogle).not.toHaveBeenCalled();
  });

  it("maps a full-event lookup failure to 500 before calendar or persistence side effects", async () => {
    mocks.eventResult = {
      data: null,
      error: { code: "08006", message: "database unavailable" },
    };

    const response = await POST(request(VALID_EVENT_ID));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Request failed" });
    expect(mocks.createCalendarEvent).not.toHaveBeenCalled();
    expect(mocks.syncEventToGoogle).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("uses zero-or-one semantics and maps a missing full event to 404", async () => {
    mocks.eventResult = { data: null, error: null };

    const response = await POST(request(VALID_EVENT_ID));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Event not found" });
    expect(mocks.fullEventMaybeSingle).toHaveBeenCalledOnce();
    expect(mocks.fullEventSingle).not.toHaveBeenCalled();
    expect(mocks.createCalendarEvent).not.toHaveBeenCalled();
    expect(mocks.syncEventToGoogle).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("prevents a non-owner student from reaching calendar side effects", async () => {
    mocks.ownership = {
      data: { id: VALID_EVENT_ID, created_by: "another-user" },
      error: null,
    };

    const response = await POST(request(VALID_EVENT_ID));

    expect(response.status).toBe(403);
    expect(mocks.createCalendarEvent).not.toHaveBeenCalled();
    expect(mocks.syncEventToGoogle).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("allows the student creator to create and persist a calendar event", async () => {
    const response = await POST(request(VALID_EVENT_ID));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      gcal_synced: true,
      gcal_reason: "",
    });
    expect(mocks.createCalendarEvent).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenCalledWith({
      google_calendar_event_id: "google-event-1",
    });
  });
});
