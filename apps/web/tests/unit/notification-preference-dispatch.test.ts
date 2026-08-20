import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  users: [
    { id: "student-on" },
    { id: "student-off" },
    { id: "student-default" },
  ],
  preferences: [
    { user_id: "student-on", events: true },
    { user_id: "student-off", events: false },
  ],
  tokens: [
    { id: "token-1", user_id: "student-on", token: "ExponentPushToken[on]" },
    { id: "token-2", user_id: "student-off", token: "ExponentPushToken[off]" },
    { id: "token-3", user_id: "student-default", token: "ExponentPushToken[default]" },
  ],
}));

const mockSupabase = {
  from: vi.fn((table: string) => {
    if (table === "debug_logs") {
      return { insert: vi.fn(async () => ({ error: null })) };
    }
    if (table === "users") {
      return {
        select: vi.fn(() => ({
          in: vi.fn(async () => ({ data: state.users, error: null })),
        })),
      };
    }
    if (table === "notification_preferences") {
      return {
        select: vi.fn(() => ({
          in: vi.fn(async () => ({ data: state.preferences, error: null })),
        })),
      };
    }
    if (table === "push_subscriptions") {
      return {
        select: vi.fn(() => ({
          in: vi.fn(async () => ({ data: [], error: null })),
        })),
      };
    }
    if (table === "expo_push_tokens") {
      return {
        select: vi.fn(() => ({
          in: vi.fn(async () => ({ data: state.tokens, error: null })),
        })),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  }),
};

vi.mock("@ambo/database/admin-client", () => ({
  createAdminClient: vi.fn(() => mockSupabase),
}));

import { sendNotificationToRole } from "@/lib/notifications";

describe("role notification preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      json: async () => ({
        data: [{ status: "ok" }, { status: "ok" }],
      }),
    })));
  });

  it("excludes opted-out users while retaining users with default preferences", async () => {
    await sendNotificationToRole(
      "student",
      {
        title: "New Event: Fall Open House",
        body: "Meet in the gym.",
        mobilePath: "/(student)/events/event-1",
      },
      undefined,
      "events",
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    const request = vi.mocked(fetch).mock.calls[0][1];
    expect(JSON.parse(String(request?.body))).toEqual([
      expect.objectContaining({ to: "ExponentPushToken[on]" }),
      expect.objectContaining({ to: "ExponentPushToken[default]" }),
    ]);
  });
});
