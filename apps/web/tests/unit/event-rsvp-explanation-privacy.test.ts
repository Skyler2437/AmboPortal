import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockState, mockSupabaseClient } = vi.hoisted(() => {
  const mockState = {
    session: {
      userId: "viewer-1",
      role: "admin",
    } as {
      userId: string;
      role: "basic" | "student" | "admin" | "superadmin" | "applicant";
    } | null,
    currentRole: "student" as "student" | "admin" | "superadmin",
    explanationUserFilter: null as string | null,
  };

  const rsvps = [
    {
      status: "maybe",
      user_id: "viewer-1",
      rsvp_option_id: null,
      users: { first_name: "Alex", last_name: "Rivera", avatar_url: null },
    },
    {
      status: "no",
      user_id: "student-2",
      rsvp_option_id: null,
      users: { first_name: "Maya", last_name: "Chen", avatar_url: null },
    },
  ];

  const explanations = [
    {
      user_id: "viewer-1",
      explanation: "I am waiting for another school commitment to be confirmed.",
    },
    {
      user_id: "student-2",
      explanation: "I have a family commitment that overlaps with this entire event.",
    },
  ];

  const mockSupabaseClient = {
    from: vi.fn((table: string) => {
      if (table === "users") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: { role: mockState.currentRole },
                error: null,
              })),
            })),
          })),
        };
      }

      if (table === "event_comments" || table === "event_rsvp_options" || table === "event_attachments") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(async () => ({ data: [], error: null })),
            })),
          })),
        };
      }

      if (table === "event_rsvps") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: rsvps, error: null })),
          })),
        };
      }

      if (table === "event_rsvp_explanations") {
        return {
          select: vi.fn(() => {
            const query = {
              eq: vi.fn((column: string, value: string) => {
                if (column === "user_id") {
                  mockState.explanationUserFilter = value;
                  return Promise.resolve({
                    data: explanations.filter((row) => row.user_id === value),
                    error: null,
                  });
                }
                return query;
              }),
              then: (
                resolve: (value: { data: typeof explanations; error: null }) => unknown,
              ) => resolve({ data: explanations, error: null }),
            };
            return query;
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
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

import { GET } from "@/app/api/events/comments/route";

function makeRequest() {
  return new NextRequest("http://localhost:3000/api/events/comments?event_id=event-1");
}

describe("event RSVP explanation privacy", () => {
  beforeEach(() => {
    mockState.session = { userId: "viewer-1", role: "admin" };
    mockState.currentRole = "student";
    mockState.explanationUserFilter = null;
  });

  it("uses the current database role and gives a student only their own explanation", async () => {
    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockState.explanationUserFilter).toBe("viewer-1");
    expect(body.rsvps).toEqual([
      expect.objectContaining({
        user_id: "viewer-1",
        explanation: "I am waiting for another school commitment to be confirmed.",
      }),
      expect.not.objectContaining({ explanation: expect.any(String) }),
    ]);
  });

  it.each(["admin", "superadmin"] as const)(
    "returns all explanations to a current %s",
    async (role) => {
      mockState.currentRole = role;

      const response = await GET(makeRequest());
      const body = await response.json();

      expect(mockState.explanationUserFilter).toBeNull();
      expect(body.rsvps).toEqual([
        expect.objectContaining({ user_id: "viewer-1", explanation: expect.any(String) }),
        expect.objectContaining({ user_id: "student-2", explanation: expect.any(String) }),
      ]);
    },
  );
});
