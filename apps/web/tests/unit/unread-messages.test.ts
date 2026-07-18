import { describe, expect, it, vi } from "vitest";
import { getUnreadMessageCount } from "@ambo/database/unread-messages";

function clientReturning(data: unknown, error: unknown = null) {
  return {
    rpc: vi.fn(async () => ({ data, error })),
  };
}

describe("getUnreadMessageCount", () => {
  it.each([
    [7, 7],
    ["12", 12],
    [0, 0],
    [-4, 0],
  ])("normalizes RPC value %p to %i", async (rpcValue, expected) => {
    const client = clientReturning(rpcValue);

    await expect(getUnreadMessageCount(client as never, "user-1")).resolves.toBe(expected);
    expect(client.rpc).toHaveBeenCalledWith("get_unread_chat_message_count", {
      target_user_id: "user-1",
    });
  });

  it("returns null when the RPC fails", async () => {
    const client = clientReturning(null, { message: "function unavailable" });

    await expect(getUnreadMessageCount(client as never, "user-1")).resolves.toBeNull();
  });

  it.each([null, undefined, "not-a-number"])(
    "returns null for invalid RPC value %p",
    async (rpcValue) => {
      const client = clientReturning(rpcValue);

      await expect(getUnreadMessageCount(client as never, "user-1")).resolves.toBeNull();
    },
  );
});
