import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockState, mockSupabaseClient } = vi.hoisted(() => {
  const mockState = {
    session: {
      userId: "student-1",
      role: "student",
    } as {
      userId: string;
      role: "basic" | "student" | "admin" | "superadmin" | "applicant";
    } | null,
    rpcArgs: null as Record<string, unknown> | null,
    rpcError: null as { message: string } | null,
  };

  const mockSupabaseClient = {
    rpc: vi.fn(async (_name: string, args: Record<string, unknown>) => {
      mockState.rpcArgs = args;
      return { error: mockState.rpcError };
    }),
    from: vi.fn((table: string) => {
      if (table !== "event_rsvps") throw new Error(`Unexpected table: ${table}`);
      return {
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({ data: [], error: null })),
        })),
      };
    }),
  };

  return { mockState, mockSupabaseClient };
});

vi.mock("@ambo/database/admin-client", () => ({
  createAdminClient: vi.fn(() => mockSupabaseClient),
}));

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => mockState.session),
}));

vi.mock("@/lib/googleCalendar", () => ({
  syncEventToGoogle: vi.fn(async () => undefined),
}));

import { POST } from "@/app/api/events/rsvp/route";

function makeRsvpRequest(body: Record<string, unknown>) {
  return new Request("http://localhost:3000/api/events/rsvp", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const fiftyCharacterExplanation = "A".repeat(50);

describe("POST /api/events/rsvp explanation requirements", () => {
  beforeEach(() => {
    mockState.session = { userId: "student-1", role: "student" };
    mockState.rpcArgs = null;
    mockState.rpcError = null;
    mockSupabaseClient.rpc.mockClear();
  });

  it.each(["maybe", "no"])(
    "requires a 50–500 character explanation for %s",
    async (status) => {
      const missing = await POST(makeRsvpRequest({ event_id: "event-1", status }));
      expect(missing.status).toBe(400);

      const tooShort = await POST(makeRsvpRequest({
        event_id: "event-1",
        status,
        explanation: "A".repeat(49),
      }));
      expect(tooShort.status).toBe(400);

      const tooLong = await POST(makeRsvpRequest({
        event_id: "event-1",
        status,
        explanation: "A".repeat(501),
      }));
      expect(tooLong.status).toBe(400);

      expect(mockSupabaseClient.rpc).not.toHaveBeenCalled();
    },
  );

  it("trims and saves a valid Maybe explanation for the authenticated user", async () => {
    const response = await POST(makeRsvpRequest({
      event_id: "event-1",
      status: "maybe",
      explanation: `  ${fiftyCharacterExplanation}  `,
    }));

    expect(response.status).toBe(200);
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      "save_event_rsvp_for_user",
      {
        target_event_id: "event-1",
        target_user_id: "student-1",
        target_status: "maybe",
        target_rsvp_option_id: null,
        target_explanation: fiftyCharacterExplanation,
      },
    );
  });

  it("allows Going without an explanation and clears any prior explanation", async () => {
    const response = await POST(makeRsvpRequest({
      event_id: "event-1",
      status: "going",
    }));

    expect(response.status).toBe(200);
    expect(mockState.rpcArgs).toEqual({
      target_event_id: "event-1",
      target_user_id: "student-1",
      target_status: "going",
      target_rsvp_option_id: null,
      target_explanation: null,
    });
  });

  it("rejects an unknown RSVP status before writing", async () => {
    const response = await POST(makeRsvpRequest({
      event_id: "event-1",
      status: "interested",
    }));

    expect(response.status).toBe(400);
    expect(mockSupabaseClient.rpc).not.toHaveBeenCalled();
  });
});
