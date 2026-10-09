import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ role: "student", send: vi.fn() }));
vi.mock("@ambo/database/admin-client", () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({
    single: async () => ({ data: { first_name: "Dylan", role: state.role }, error: null }),
  }) }) }) }),
}));
vi.mock("@/lib/notifications", () => ({
  sendNotificationToRole: state.send, sendNotificationToUser: vi.fn(),
}));
vi.mock("@/lib/chat-notification", () => ({ handleChatMessage: vi.fn() }));
import { POST } from "@/app/api/webhooks/notifications/route";

describe("new post recipients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_WEBHOOK_SECRET = "test-secret";
  });
  it.each(["student", "admin", "superadmin"])("notifies students and staff for a %s post, honoring preferences and excluding its author", async role => {
    state.role = role;
    const response = await POST(new NextRequest("http://localhost/api/webhooks/notifications", {
      method: "POST", headers: { "x-webhook-secret": "test-secret" },
      body: JSON.stringify({ type: "INSERT", table: "posts", schema: "public",
        record: { id: `post-${role}`, user_id: "author", content: "Please RSVP" } }),
    }));
    expect(response.status).toBe(200);
    expect(state.send.mock.calls.map(call => call[0])).toEqual(["admin", "student"]);
    for (const [target, payload, excluded, preference] of state.send.mock.calls) {
      expect(excluded).toBe("author");
      expect(preference).toBe("new_posts");
      expect(payload.mobilePath).toBe(`/(${target})/posts`);
    }
  });
});
