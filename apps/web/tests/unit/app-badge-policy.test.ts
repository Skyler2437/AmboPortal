import { describe, expect, it } from "vitest";
import { badgeCountToApply } from "@ambo/database/unread-messages";

describe("badgeCountToApply", () => {
  it.each([
    [5, 5],
    [0, 0],
  ])("applies an authoritative unread total of %i", (count, expected) => {
    expect(badgeCountToApply(count)).toBe(expected);
  });

  it("returns null after a failed lookup so the current badge is preserved", () => {
    expect(badgeCountToApply(null)).toBeNull();
  });
});
