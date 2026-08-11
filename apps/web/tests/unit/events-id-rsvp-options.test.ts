import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const EVENT_ID = "550e8400-e29b-41d4-a716-446655440000";
const OPTION_A = "550e8400-e29b-41d4-a716-446655440001";
const OPTION_B = "550e8400-e29b-41d4-a716-446655440002";
const UNKNOWN_OPTION = "550e8400-e29b-41d4-a716-446655440099";

type OptionRow = {
  id: string;
  event_id: string;
  label: string;
  sort_order: number;
};

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  syncEventToGoogle: vi.fn(),
  optionState: [] as OptionRow[],
  rsvpState: [] as Array<{
    user_id: string;
    status: string;
    rsvp_option_id: string | null;
  }>,
  updateError: null as { message: string } | null,
  mutationCalls: 0,
  nextId: 10,
}));

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => ({ userId: "owner", role: "student" })),
}));

vi.mock("@ambo/database/admin-client", () => ({
  createAdminClient: vi.fn(() => ({ from: mocks.from })),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/googleCalendar", () => ({
  deleteCalendarEvent: vi.fn(),
  syncEventToGoogle: mocks.syncEventToGoogle,
}));

import { PUT } from "@/app/api/events/[id]/route";

function put(body: unknown) {
  return PUT(new NextRequest(`http://localhost:3000/api/events/${EVENT_ID}`, {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }), { params: { id: EVENT_ID } });
}

describe("PUT /api/events/[id] RSVP options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateError = null;
    mocks.mutationCalls = 0;
    mocks.nextId = 10;
    mocks.optionState = [
      {
        id: OPTION_A,
        event_id: EVENT_ID,
        label: "Morning shift",
        sort_order: 0,
      },
      {
        id: OPTION_B,
        event_id: EVENT_ID,
        label: "Afternoon shift",
        sort_order: 1,
      },
    ];
    mocks.rsvpState = [
      { user_id: "student-1", status: "going", rsvp_option_id: OPTION_B },
    ];

    mocks.from.mockImplementation((table: string) => {
      if (table === "users") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: { role: "student" },
                error: null,
              })),
            })),
          })),
        };
      }

      if (table === "events") {
        return {
          select: vi.fn((columns: string) => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: columns === "created_by"
                  ? { created_by: "owner" }
                  : {
                      start_time: "2026-08-01T17:00:00.000Z",
                      end_time: "2026-08-01T19:00:00.000Z",
                    },
                error: null,
              })),
            })),
          })),
        };
      }

      if (table !== "event_rsvp_options") {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(async () => ({
              data: [...mocks.optionState]
                .sort((a, b) => a.sort_order - b.sort_order)
                .map(({ id, label, sort_order }) => ({ id, label, sort_order })),
              error: null,
            })),
          })),
        })),
        update: vi.fn((changes: Partial<OptionRow>) => ({
          eq: vi.fn((_column: string, id: string) => ({
            eq: vi.fn(async () => {
              mocks.mutationCalls += 1;
              if (mocks.updateError) return { error: mocks.updateError };
              const row = mocks.optionState.find((option) => option.id === id);
              if (row) Object.assign(row, changes);
              return { error: null };
            }),
          })),
        })),
        insert: vi.fn(async (rows: Array<Omit<OptionRow, "id">>) => {
          mocks.mutationCalls += 1;
          for (const row of rows) {
            mocks.optionState.push({
              ...row,
              id: `550e8400-e29b-41d4-a716-4466554400${mocks.nextId++}`,
            });
          }
          return { error: null };
        }),
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            in: vi.fn(async (_column: string, ids: string[]) => {
              mocks.mutationCalls += 1;
              mocks.optionState = mocks.optionState.filter(
                (option) => !ids.includes(option.id),
              );
              for (const rsvp of mocks.rsvpState) {
                if (rsvp.rsvp_option_id && ids.includes(rsvp.rsvp_option_id)) {
                  rsvp.rsvp_option_id = null;
                }
              }
              return { error: null };
            }),
          })),
        })),
      };
    });
  });

  it("renames in place, inserts new rows, and preserves going RSVPs on delete", async () => {
    const response = await put({
      rsvp_options: [
        { id: OPTION_A, label: "Renamed option" },
        { label: "Evening shift" },
      ],
    });

    expect(response.status).toBe(200);
    expect(mocks.optionState.find((option) => option.id === OPTION_A)?.label)
      .toBe("Renamed option");
    expect(mocks.optionState.some((option) => option.id === OPTION_B)).toBe(false);
    expect(mocks.rsvpState[0]).toEqual({
      user_id: "student-1",
      status: "going",
      rsvp_option_id: null,
    });
    expect(await response.json()).toMatchObject({
      rsvp_options: [
        { id: OPTION_A, label: "Renamed option", sort_order: 0 },
        { label: "Evening shift", sort_order: 1 },
      ],
      gcal_sync: { synced: false, reason: "No calendar fields changed" },
    });
    expect(mocks.syncEventToGoogle).not.toHaveBeenCalled();
  });

  it("rejects an option ID from another event before mutating", async () => {
    const response = await put({
      rsvp_options: [{ id: UNKNOWN_OPTION, label: "Other option" }],
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "RSVP option does not belong to this event",
    });
    expect(mocks.mutationCalls).toBe(0);
  });

  it("returns a server error when an option mutation fails", async () => {
    mocks.updateError = { message: "database unavailable" };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await put({
      rsvp_options: [{ id: OPTION_A, label: "Renamed option" }],
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to update RSVP options",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "[Events PUT] RSVP option update failed:",
      mocks.updateError,
    );
    errorSpy.mockRestore();
  });

  it("keeps the legacy string-array behavior", async () => {
    const response = await put({
      rsvp_options: ["Afternoon shift", "New shift"],
    });

    expect(response.status).toBe(200);
    expect(mocks.optionState.find((option) => option.id === OPTION_B))
      .toMatchObject({ label: "Afternoon shift", sort_order: 0 });
    expect(mocks.optionState.some((option) => option.id === OPTION_A)).toBe(false);
  });
});
