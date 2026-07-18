import { describe, expect, it } from "vitest";
import { buildExpoPushMessage } from "@/lib/notifications";

const basePayload = {
  title: "New message",
  body: "Hello",
  url: "/student/chat?group=group-1",
  mobilePath: "/(student)/chat/group-1",
};

describe("buildExpoPushMessage", () => {
  it("includes a positive iOS badge count", () => {
    expect(buildExpoPushMessage("ExponentPushToken[token]", { ...basePayload, badge: 4 }))
      .toMatchObject({ badge: 4 });
  });

  it("retains badge zero so iOS clears a fully-read badge", () => {
    expect(buildExpoPushMessage("ExponentPushToken[token]", { ...basePayload, badge: 0 }))
      .toMatchObject({ badge: 0 });
  });

  it("omits badge for notification categories that do not affect chat unread state", () => {
    expect(buildExpoPushMessage("ExponentPushToken[token]", basePayload)).not.toHaveProperty("badge");
  });
});
