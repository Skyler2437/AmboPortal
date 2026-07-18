import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/.well-known/oauth-protected-resource/route";

describe("MCP protected resource metadata", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://lcsambos.vercel.app";
  });

  it("advertises the exact streamable HTTP endpoint", async () => {
    const response = await GET();

    expect(await response.json()).toMatchObject({
      resource: "https://lcsambos.vercel.app/api/mcp/mcp",
    });
  });
});
