import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const nextConfig = require("../../next.config.js");

describe("OAuth authorization CSP", () => {
  it("allows a successful form authorization to redirect to ChatGPT", async () => {
    const rules = await nextConfig.headers();
    const globalRule = rules.find((rule: { source: string }) => rule.source === "/(.*)");
    const csp = globalRule.headers.find(
      (header: { key: string }) => header.key === "Content-Security-Policy"
    ).value;

    expect(csp).toContain("form-action 'self' https://chatgpt.com");
  });
});
