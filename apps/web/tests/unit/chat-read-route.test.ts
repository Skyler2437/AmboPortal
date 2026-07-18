import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { userId: "user-1", role: "student" } as { userId: string; role: string } | null,
  membership: { data: { group_id: "group-1" }, error: null } as {
    data: { group_id: string } | null;
    error: { message: string } | null;
  },
  updateResult: { error: null } as { error: { message: string } | null },
  update: vi.fn(),
}));

const mockSupabase = {
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => mocks.membership),
        })),
      })),
    })),
    update: mocks.update,
  })),
};

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => mocks.session),
}));

vi.mock("@ambo/database/admin-client", () => ({
  createAdminClient: vi.fn(() => mockSupabase),
}));

import { POST } from "@/app/api/chat/groups/[id]/read/route";

describe("POST /api/chat/groups/:id/read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = { userId: "user-1", role: "student" };
    mocks.membership = { data: { group_id: "group-1" }, error: null };
    mocks.updateResult = { error: null };
    mocks.update.mockReturnValue({
      eq: vi.fn(() => ({
        eq: vi.fn(async () => mocks.updateResult),
      })),
    });
  });

  it("rejects unauthenticated callers", async () => {
    mocks.session = null;

    const response = await POST(new Request("http://localhost"), { params: { id: "group-1" } });

    expect(response.status).toBe(401);
  });

  it("rejects users who are not participants", async () => {
    mocks.membership = { data: null, error: null };

    const response = await POST(new Request("http://localhost"), { params: { id: "group-1" } });

    expect(response.status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("updates only the authenticated participant", async () => {
    const response = await POST(new Request("http://localhost"), { params: { id: "group-1" } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.update).toHaveBeenCalledWith({ last_read_at: expect.any(String) });
  });

  it("returns 500 when the read timestamp cannot be persisted", async () => {
    mocks.updateResult = { error: { message: "database unavailable" } };

    const response = await POST(new Request("http://localhost"), { params: { id: "group-1" } });

    expect(response.status).toBe(500);
  });
});
