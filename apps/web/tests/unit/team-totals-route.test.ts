import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type User = { id: string; role: string; first_name: string; last_name: string; phone: string; email: string };
type Submission = { id: string; user_id: string; hours: number | string | null; credits: number | string | null; status: string };
const mocks = vi.hoisted(() => ({
  authorized: true,
  users: [] as User[],
  submissions: [] as Submission[],
  rowCap: 500,
  failedTable: "",
  emptyPageAt: -1,
  queries: [] as { table: string; select: string; filters: Record<string, unknown>; orders: string[]; range: number[] }[],
  from: vi.fn(),
}));
vi.mock("@/lib/admin", () => ({ requireAdmin: async () => ({ authorized: mocks.authorized, supabase: { from: mocks.from } }) }));
vi.mock("@ambo/database/admin-client", () => ({ createAdminClient: vi.fn() }));
import { GET } from "@/app/api/admin/users/route";

const request = (query = "includeTotals=true") => new NextRequest(`http://localhost/api/admin/users?${query}`);
beforeEach(() => {
  mocks.authorized = true;
  mocks.rowCap = 500;
  mocks.failedTable = "";
  mocks.emptyPageAt = -1;
  mocks.queries = [];
  mocks.users = ["amy", "ben", "staff"].map((id) => ({ id, role: id === "staff" ? "admin" : "student", first_name: id, last_name: "User", phone: "5550000000", email: `${id}@example.com` }));
  mocks.submissions = [
    { id: "1", user_id: "amy", hours: "0.1", credits: 1, status: "Approved" },
    { id: "2", user_id: "amy", hours: 0.2, credits: "2", status: "Approved" },
    { id: "3", user_id: "ben", hours: 10, credits: 10, status: "Pending" },
    { id: "4", user_id: "ben", hours: 10, credits: 10, status: "Denied" },
    { id: "5", user_id: "staff", hours: 100, credits: 100, status: "Approved" },
    { id: "6", user_id: "outside-page", hours: 1000, credits: 1000, status: "Approved" },
  ];
  mocks.from.mockReset().mockImplementation((table: string) => {
    const query = { table, select: "", filters: {} as Record<string, unknown>, orders: [] as string[], range: [] as number[] };
    mocks.queries.push(query);
    const builder = {
      select: vi.fn((fields: string) => { query.select = fields; return builder; }),
      in: vi.fn((key: string, value: string[]) => { query.filters[key] = value; return builder; }),
      eq: vi.fn((key: string, value: string) => { query.filters[key] = value; return builder; }),
      order: vi.fn((key: string) => { query.orders.push(key); return builder; }),
      range: vi.fn(async (from: number, to: number) => {
        query.range = [from, to];
        if (table === mocks.failedTable) return { data: null, error: { message: "Unavailable" }, count: null };
        if (table === "users") return { data: mocks.users.slice(from, to + 1), count: mocks.users.length, error: null };
        const rows = mocks.submissions.filter((row) => (query.filters.user_id as string[]).includes(row.user_id) && row.status === query.filters.status);
        return { data: from === mocks.emptyPageAt ? [] : rows.slice(from, Math.min(to + 1, from + mocks.rowCap)), count: rows.length, error: null };
      }),
    };
    return builder;
  });
});

describe("Team totals API", () => {
  it("returns all-time approved totals, zero for students without approved work, and no totals for staff", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.map(({ id, total_hours, total_credits }: Record<string, unknown>) => ({ id, total_hours, total_credits }))).toEqual([
      { id: "amy", total_hours: 0.3, total_credits: 3 },
      { id: "ben", total_hours: 0, total_credits: 0 },
      { id: "staff", total_hours: null, total_credits: null },
    ]);
    expect(mocks.queries[1].filters).toEqual({ user_id: ["amy", "ben"], status: "Approved" });
    expect(mocks.queries[0].orders).toEqual(["last_name", "id"]);
    expect(mocks.queries[1].select).toBe("user_id, hours, credits");
  });

  it("sums beyond 1,000 submissions, including when Supabase returns fewer rows than requested", async () => {
    mocks.rowCap = 250;
    mocks.submissions = Array.from({ length: 1201 }, (_, i) => ({ id: `${i}`, user_id: "amy", hours: 0.25, credits: 1, status: "Approved" }));
    const body = await (await GET(request())).json();
    expect(body.data[0]).toMatchObject({ total_hours: 300.25, total_credits: 1201 });
    expect(mocks.queries.filter((query) => query.table === "submissions").map((query) => query.range[0])).toEqual([0, 250, 500, 750, 1000]);
  });

  it("only fetches totals for students in the requested roster page", async () => {
    const body = await (await GET(request("includeTotals=true&limit=1&page=2"))).json();
    expect(body.data).toEqual([{ ...mocks.users[1], total_hours: 0, total_credits: 0 }]);
    expect(body.pagination).toMatchObject({ page: 2, total: 3, totalPages: 3 });
    expect(mocks.queries[1].filters.user_id).toEqual(["ben"]);
  });

  it("skips submission queries for a page without students", async () => {
    await GET(request("includeTotals=true&limit=1&page=3"));
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("preserves the original users response when totals are not requested", async () => {
    const body = await (await GET(request(""))).json();
    expect(body.data).toEqual(mocks.users);
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("rejects non-admin requests before reading user or submission data", async () => {
    mocks.authorized = false;
    expect((await GET(request())).status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each(["users", "submissions"])("returns an error when %s cannot load instead of reporting zero", async (table) => {
    mocks.failedTable = table;
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.json()).not.toHaveProperty("data");
  });

  it("rejects an incomplete later page instead of returning partial totals", async () => {
    mocks.rowCap = 1;
    mocks.emptyPageAt = 1;
    expect((await GET(request())).status).toBe(500);
  });

  it("treats historical null amounts as zero", async () => {
    mocks.submissions = [{ id: "null", user_id: "amy", hours: null, credits: null, status: "Approved" }];
    const body = await (await GET(request())).json();
    expect(body.data[0]).toMatchObject({ total_hours: 0, total_credits: 0 });
  });
});
