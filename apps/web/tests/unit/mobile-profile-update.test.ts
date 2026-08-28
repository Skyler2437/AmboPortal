import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  authenticatedUser: {
    id: "student-1",
    email: "chaz@example.edu",
  } as { id: string; email: string } | null,
  authError: null as { message: string } | null,
  updateResult: {
    data: {
      id: "student-1",
      first_name: "Chaz",
      last_name: "Di Nieri",
      phone: "5555555555",
      avatar_url: null as string | null,
    },
    error: null as { message: string } | null,
  },
  update: vi.fn(),
  from: vi.fn(),
  updatedValues: null as Record<string, unknown> | null,
  updatedUserId: null as string | null,
}));

const authClient = {
  auth: {
    getUser: vi.fn(async () => ({
      data: { user: mocks.authenticatedUser },
      error: mocks.authError,
    })),
  },
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => authClient),
}));

vi.mock("@ambo/database/admin-client", () => ({
  createAdminClient: vi.fn(() => ({ from: mocks.from })),
}));

type ProfileRoute = {
  POST: (request: NextRequest) => Promise<Response>;
};

async function loadRoute(): Promise<ProfileRoute | null> {
  return import("@/app/api/mobile/profile/route").catch(() => null) as Promise<ProfileRoute | null>;
}

function request(body: unknown, authorization = "Bearer valid-token") {
  return new NextRequest("http://localhost:3000/api/mobile/profile", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authorization,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/mobile/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    mocks.authenticatedUser = { id: "student-1", email: "chaz@example.edu" };
    mocks.authError = null;
    mocks.updateResult = {
      data: {
        id: "student-1",
        first_name: "Chaz",
        last_name: "Di Nieri",
        phone: "5555555555",
        avatar_url: null,
      },
      error: null,
    };
    mocks.updatedValues = null;
    mocks.updatedUserId = null;
    mocks.update.mockImplementation((values: Record<string, unknown>) => {
      mocks.updatedValues = values;
      return {
        eq: vi.fn((_column: string, userId: string) => {
          mocks.updatedUserId = userId;
          return {
            select: vi.fn(() => ({
              maybeSingle: vi.fn(async () => mocks.updateResult),
            })),
          };
        }),
      };
    });
    mocks.from.mockReturnValue({ update: mocks.update });
  });

  it("updates only the authenticated caller's allowed profile fields", async () => {
    const route = await loadRoute();

    expect(route).not.toBeNull();
    if (!route) return;

    const response = await route.POST(request({
      firstName: " Chaz ",
      lastName: " Di Nieri ",
      phone: "5555555555",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ profile: mocks.updateResult.data });
    expect(mocks.updatedValues).toEqual({
      first_name: "Chaz",
      last_name: "Di Nieri",
      phone: "5555555555",
    });
    expect(mocks.updatedUserId).toBe("student-1");
  });

  it("rejects a client attempt to change a server-managed profile field", async () => {
    const route = await loadRoute();

    expect(route).not.toBeNull();
    if (!route) return;

    const response = await route.POST(request({
      firstName: "Chaz",
      role: "superadmin",
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unsupported profile field" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects an avatar URL outside the authenticated user's avatar path", async () => {
    const route = await loadRoute();

    expect(route).not.toBeNull();
    if (!route) return;

    const response = await route.POST(request({
      avatarUrl: "https://example.com/not-chaz.jpg",
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid avatar URL" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("requires a valid authenticated mobile session", async () => {
    const route = await loadRoute();

    expect(route).not.toBeNull();
    if (!route) return;

    mocks.authenticatedUser = null;
    const response = await route.POST(request({ firstName: "Chaz" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
