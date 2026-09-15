import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAllPages } from "@/lib/fetch-all-pages";

afterEach(() => vi.unstubAllGlobals());

describe("complete admin table loading", () => {
  it("loads every roster page while preserving the totals query", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: [1], pagination: { totalPages: 3 } }))
      .mockResolvedValueOnce(Response.json({ data: [2], pagination: { totalPages: 3 } }))
      .mockResolvedValueOnce(Response.json({ data: [3], pagination: { totalPages: 3 } }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchAllPages("/api/admin/users?includeTotals=true", 1)).resolves.toEqual([1, 2, 3]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([1, 2, 3].map((page) => `/api/admin/users?includeTotals=true&limit=1&page=${page}`));
  });

  it.each([1, 2])("rejects a failed page %s instead of displaying an incomplete roster", async (failedPage) => {
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(url.endsWith(`page=${failedPage}`)
      ? Response.json({ error: "Unavailable" }, { status: 500 })
      : Response.json({ data: [1], pagination: { totalPages: 2 } }))));
    await expect(fetchAllPages("/api/admin/users")).rejects.toThrow("500");
  });

  it("preserves legacy flat-array responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([{ id: "legacy" }])));
    await expect(fetchAllPages("/api/admin/users")).resolves.toEqual([{ id: "legacy" }]);
  });

  it("never silently truncates a roster at the page safety limit", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: [1], pagination: { totalPages: 101 } })));
    await expect(fetchAllPages("/api/admin/users")).rejects.toThrow("completely");
  });
});
