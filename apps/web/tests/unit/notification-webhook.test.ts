import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendNotificationToUser: vi.fn(
    async (_userId: string, _payload: Record<string, unknown>) => undefined,
  ),
  getUnreadMessageCount: vi.fn(),
  participantsEq: vi.fn(async () => ({
    data: [{ user_id: "sender" }, { user_id: "recipient" }],
    error: null,
  })),
}));

const mockSupabase = {
  from: vi.fn((table: string) => {
    if (table === "chat_participants") {
      return { select: vi.fn(() => ({ eq: mocks.participantsEq })) };
    }
    if (table === "users") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({ data: { first_name: "Skyler" } })),
          })),
          in: vi.fn(async () => ({
            data: [{ id: "recipient", role: "student" }],
          })),
        })),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  }),
};

vi.mock("@ambo/database/admin-client", () => ({
  createAdminClient: vi.fn(() => mockSupabase),
}));

vi.mock("@ambo/database/unread-messages", () => ({
  getUnreadMessageCount: mocks.getUnreadMessageCount,
}));

vi.mock("@/lib/notifications", () => ({
  sendNotificationToUser: mocks.sendNotificationToUser,
  sendNotificationToRole: vi.fn(),
}));

import { handleChatMessage } from "@/lib/chat-notification";

describe("chat notification badge dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends the recipient's authoritative unread total", async () => {
    mocks.getUnreadMessageCount.mockResolvedValue(6);

    await handleChatMessage({
      group_id: "group-1",
      sender_id: "sender",
      content: "Hello",
    });

    expect(mocks.sendNotificationToUser).toHaveBeenCalledWith("recipient", {
      title: "Skyler",
      body: "Hello",
      url: "/student/chat?group=group-1",
      mobilePath: "/(student)/chat/group-1",
      badge: 6,
    });
  });

  it("still sends chat push without a badge when unread lookup fails", async () => {
    mocks.getUnreadMessageCount.mockResolvedValue(null);

    await handleChatMessage({
      group_id: "group-1",
      sender_id: "sender",
      content: "Hello",
    });

    const payload = mocks.sendNotificationToUser.mock.calls[0][1];
    expect(payload).not.toHaveProperty("badge");
  });
});
