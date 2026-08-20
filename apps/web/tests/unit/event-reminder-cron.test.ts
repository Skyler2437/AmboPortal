import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSupabase = {
  from: vi.fn((table: string) => {
    if (table !== "events") throw new Error(`Unexpected table ${table}`);
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          gte: vi.fn(() => ({
            lte: vi.fn(async () => ({ data: [], error: null })),
          })),
        })),
      })),
    };
  }),
};

vi.mock("@ambo/database/admin-client", () => ({
  createAdminClient: vi.fn(() => mockSupabase),
}));

vi.mock("@/lib/notifications", () => ({
  sendNotificationToUser: vi.fn(async () => undefined),
}));

import * as reminderRoute from "@/app/api/events/send-reminders/route";

describe("scheduled event reminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-cron-secret";
  });

  it("runs from the authenticated GET request used by Vercel Cron", async () => {
    const getHandler = (reminderRoute as {
      GET?: (request: Request) => Promise<Response>;
    }).GET;

    const response = await getHandler?.(new Request(
      "http://localhost:3000/api/events/send-reminders",
      {
        method: "GET",
        headers: { Authorization: "Bearer test-cron-secret" },
      },
    ));

    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({
      ok: true,
      eventsProcessed: 0,
      notificationsSent: 0,
    });
  });
});
