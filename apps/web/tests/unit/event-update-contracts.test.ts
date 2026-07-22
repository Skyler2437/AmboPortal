import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("event update tool contracts", () => {
  it("does not reference the dropped events.location column", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/mcp/tools/admin-tools.ts"),
      "utf8",
    );
    const updateEventBlock = source.match(
      /server\.registerTool\("update_event",[\s\S]*?server\.registerTool\("update_user",/,
    )?.[0] ?? "";

    expect(updateEventBlock).not.toBe("");
    expect(updateEventBlock).not.toMatch(/\blocation\b/);
    expect(updateEventBlock).toContain(
      '.select("id, title, description, start_time, end_time, type, uniform")',
    );
  });
});
