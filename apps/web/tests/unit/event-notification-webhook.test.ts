import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  creator: {
    first_name: "Skyler",
    role: "admin" as "student" | "admin" | "superadmin",
  },
  sendNotificationToRole: vi.fn(async () => undefined),
}));

const mockSupabase = {
  from: vi.fn((table: string) => {
    if (table !== "users") throw new Error(`Unexpected table ${table}`);
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({ data: mocks.creator, error: null })),
        })),
      })),
    };
  }),
};

vi.mock("@ambo/database/admin-client", () => ({
  createAdminClient: vi.fn(() => mockSupabase),
}));

vi.mock("@/lib/chat-notification", () => ({
  handleChatMessage: vi.fn(async () => undefined),
}));

vi.mock("@/lib/notifications", () => ({
  sendNotificationToUser: vi.fn(async () => undefined),
  sendNotificationToRole: mocks.sendNotificationToRole,
}));

import { POST } from "@/app/api/webhooks/notifications/route";

function eventWebhookRequest(record: Record<string, unknown>) {
  return new NextRequest("http://localhost:3000/api/webhooks/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-webhook-secret": "test-webhook-secret",
    },
    body: JSON.stringify({
      type: "INSERT",
      table: "events",
      schema: "public",
      record,
      old_record: null,
    }),
  });
}

describe("event notification webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_WEBHOOK_SECRET = "test-webhook-secret";
    mocks.creator.first_name = "Skyler";
    mocks.creator.role = "admin";
  });

  it("notifies admins and students when an admin creates an event", async () => {
    const response = await POST(eventWebhookRequest({
      id: "event-admin-1",
      created_by: "admin-1",
      title: "Fall Open House",
      description: "Meet in the gym at 5:00 PM.",
    }));

    expect(response.status).toBe(200);
    expect(mocks.sendNotificationToRole).toHaveBeenNthCalledWith(
      1,
      "admin",
      {
        title: "New Event from Skyler",
        body: "Fall Open House: Meet in the gym at 5:00 PM.",
        url: "/admin/events",
        mobilePath: "/(admin)/events/event-admin-1",
      },
      "admin-1",
      "events",
    );
    expect(mocks.sendNotificationToRole).toHaveBeenNthCalledWith(
      2,
      "student",
      {
        title: "New Event: Fall Open House",
        body: "Meet in the gym at 5:00 PM.",
        url: "/student/events",
        mobilePath: "/(student)/events/event-admin-1",
      },
      "admin-1",
      "events",
    );
  });

  it("notifies only admins when a student creates an event", async () => {
    mocks.creator.role = "student";

    const response = await POST(eventWebhookRequest({
      id: "event-student-1",
      created_by: "student-1",
      title: "Campus Tour",
      description: null,
    }));

    expect(response.status).toBe(200);
    expect(mocks.sendNotificationToRole).toHaveBeenCalledTimes(1);
    expect(mocks.sendNotificationToRole).toHaveBeenCalledWith(
      "admin",
      {
        title: "New Event from Skyler",
        body: "Campus Tour",
        url: "/admin/events",
        mobilePath: "/(admin)/events/event-student-1",
      },
      "student-1",
      "events",
    );
  });
});
