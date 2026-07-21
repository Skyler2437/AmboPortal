import { describe, expect, it } from "vitest";
import { authorizeEvent, canManageEvent } from "@/lib/eventPermissions";

describe("canManageEvent", () => {
  it.each([
    [{ userId: "owner", role: "student" }, "owner", true],
    [{ userId: "other", role: "student" }, "owner", false],
    [{ userId: "admin", role: "admin" }, "owner", true],
    [{ userId: "super", role: "superadmin" }, "owner", true],
    [{ userId: "applicant", role: "applicant" }, "applicant", false],
  ])("checks role and ownership", (user, createdBy, expected) => {
    expect(canManageEvent(user, createdBy)).toBe(expected);
  });

  it("returns not_found without authorizing a missing event", async () => {
    await expect(
      authorizeEvent(
        { userId: "admin", role: "admin" },
        "missing",
        async () => undefined,
      ),
    ).resolves.toEqual({ status: "not_found" });
  });

  it("loads ownership and returns allowed or forbidden", async () => {
    const loadCreator = async () => "owner";
    await expect(
      authorizeEvent(
        { userId: "owner", role: "student" },
        "event-1",
        loadCreator,
      ),
    ).resolves.toEqual({ status: "allowed", createdBy: "owner" });
    await expect(
      authorizeEvent(
        { userId: "other", role: "student" },
        "event-1",
        loadCreator,
      ),
    ).resolves.toEqual({ status: "forbidden", createdBy: "owner" });
  });
});
