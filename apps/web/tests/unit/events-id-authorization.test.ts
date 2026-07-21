import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const VALID_EVENT_ID = "550e8400-e29b-41d4-a716-446655440000";

const mocks = vi.hoisted(() => ({
  session: { userId: "owner", role: "student" } as {
    userId: string;
    role: string;
  } | null,
  ownership: {
    data: { created_by: "owner" } as { created_by: string | null } | null,
    error: null as { code?: string; message: string } | null,
  },
  updatedEvent: { id: "550e8400-e29b-41d4-a716-446655440000" },
  from: vi.fn(),
  update: vi.fn(),
  deleteEvent: vi.fn(),
  syncEventToGoogle: vi.fn(),
  deleteCalendarEvent: vi.fn(),
}));

const mockSupabase = {
  from: mocks.from,
};

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => mocks.session),
}));

vi.mock("@ambo/database/admin-client", () => ({
  createAdminClient: vi.fn(() => mockSupabase),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/googleCalendar", () => ({
  deleteCalendarEvent: mocks.deleteCalendarEvent,
  syncEventToGoogle: mocks.syncEventToGoogle,
}));

import { DELETE, PUT } from "@/app/api/events/[id]/route";

function request(method: "PUT" | "DELETE") {
  return new NextRequest(`http://localhost:3000/api/events/${VALID_EVENT_ID}`, {
    method,
    ...(method === "PUT" && {
      body: JSON.stringify({ title: "Updated title" }),
      headers: { "Content-Type": "application/json" },
    }),
  });
}

describe("event update/delete authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = { userId: "owner", role: "student" };
    mocks.ownership = {
      data: { created_by: "owner" },
      error: null,
    };
    mocks.syncEventToGoogle.mockResolvedValue({ synced: true });
    mocks.update.mockReturnValue({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: mocks.updatedEvent,
            error: null,
          })),
        })),
      })),
    });
    mocks.deleteEvent.mockReturnValue({
      eq: vi.fn(async () => ({ error: null })),
    });
    mocks.from.mockImplementation((table: string) => {
      expect(table).toBe("events");
      return {
        select: vi.fn((columns: string) => ({
          eq: vi.fn(() => {
            if (columns === "created_by") {
              return {
                maybeSingle: vi.fn(async () => mocks.ownership),
              };
            }
            return {
              single: vi.fn(async () => ({
                data: { google_calendar_event_id: null },
                error: null,
              })),
            };
          }),
        })),
        update: mocks.update,
        delete: mocks.deleteEvent,
      };
    });
  });

  it.each(["PUT", "DELETE"] as const)(
    "%s returns 400 for a malformed path ID before querying",
    async (method) => {
      const handler = method === "PUT" ? PUT : DELETE;
      const response = await handler(request(method), {
        params: { id: "not-a-uuid" },
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Invalid event ID" });
      expect(mocks.from).not.toHaveBeenCalled();
    },
  );

  it.each(["PUT", "DELETE"] as const)(
    "%s maps an ownership lookup failure to 500",
    async (method) => {
      mocks.ownership = {
        data: null,
        error: { code: "08006", message: "database unavailable" },
      };
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const handler = method === "PUT" ? PUT : DELETE;

      const response = await handler(request(method), {
        params: { id: VALID_EVENT_ID },
      });

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Request failed" });
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("ownership"),
        expect.objectContaining({ code: "08006", message: "database unavailable" }),
      );
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.deleteEvent).not.toHaveBeenCalled();
      expect(mocks.syncEventToGoogle).not.toHaveBeenCalled();
      expect(mocks.deleteCalendarEvent).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    },
  );

  it.each(["PUT", "DELETE"] as const)(
    "%s maps a successful zero-row ownership lookup to 404",
    async (method) => {
      mocks.ownership = { data: null, error: null };
      const handler = method === "PUT" ? PUT : DELETE;

      const response = await handler(request(method), {
        params: { id: VALID_EVENT_ID },
      });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Event not found" });
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.deleteEvent).not.toHaveBeenCalled();
    },
  );

  it.each(["PUT", "DELETE"] as const)(
    "%s prevents a non-owner student from reaching mutations or calendar side effects",
    async (method) => {
      mocks.session = { userId: "other", role: "student" };
      const handler = method === "PUT" ? PUT : DELETE;

      const response = await handler(request(method), {
        params: { id: VALID_EVENT_ID },
      });

      expect(response.status).toBe(403);
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.deleteEvent).not.toHaveBeenCalled();
      expect(mocks.syncEventToGoogle).not.toHaveBeenCalled();
      expect(mocks.deleteCalendarEvent).not.toHaveBeenCalled();
    },
  );

  it("allows the student creator to update and sync the event", async () => {
    const response = await PUT(request("PUT"), {
      params: { id: VALID_EVENT_ID },
    });

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalled();
    expect(mocks.syncEventToGoogle).toHaveBeenCalledWith(VALID_EVENT_ID);
  });

  it("allows the student creator to delete the event", async () => {
    const response = await DELETE(request("DELETE"), {
      params: { id: VALID_EVENT_ID },
    });

    expect(response.status).toBe(200);
    expect(mocks.deleteEvent).toHaveBeenCalled();
  });
});
