import { describe, expect, it } from "vitest";
import { createTable, functionalUpdate, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, TableState } from "@tanstack/react-table";
import { formatTeamTotal, searchTeam, teamDataColumns, TeamTableRow } from "@/lib/teamTable";

function member(id: string, overrides: Partial<TeamTableRow> = {}): TeamTableRow {
  return { id, first_name: id, last_name: "Student", email: `${id}@example.com`, phone: "5550000000", role: "student", total_hours: 0, total_credits: 0, ...overrides };
}
const rows = [
  member("amy", { phone: "5553330000", total_hours: 10, total_credits: 2 }),
  member("ben", { phone: "5552220000", total_hours: 2.5, total_credits: 10 }),
  member("cara", { phone: "5551110000" }),
  member("staff", { role: "admin", phone: "5554440000", total_hours: null, total_credits: null }),
];

function makeTable(data = rows, overrides: Partial<TableState> = {}) {
  const table = createTable<TeamTableRow>({
    data, columns: teamDataColumns, state: {}, onStateChange: () => {}, renderFallbackValue: null,
    getRowId: (row) => row.id, autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
  });
  let state = { ...table.initialState, ...overrides };
  table.setOptions((options) => ({ ...options, state, onStateChange: (updater) => {
    state = functionalUpdate(updater, state);
    table.setOptions((previous) => ({ ...previous, state }));
  } }));
  return table;
}
const ids = (table: ReturnType<typeof makeTable>) => table.getRowModel().rows.map((row) => row.id);

describe("Team table", () => {
  it.each([
    ["name", ["amy", "ben", "cara", "staff"], ["staff", "cara", "ben", "amy"]],
    ["email", ["amy", "ben", "cara", "staff"], ["staff", "cara", "ben", "amy"]],
    ["phone", ["cara", "ben", "amy", "staff"], ["staff", "amy", "ben", "cara"]],
    ["role", ["staff", "amy", "ben", "cara"], ["amy", "ben", "cara", "staff"]],
    ["total_hours", ["cara", "ben", "amy", "staff"], ["amy", "ben", "cara", "staff"]],
    ["total_credits", ["cara", "amy", "ben", "staff"], ["ben", "amy", "cara", "staff"]],
  ] as const)("sorts %s in both directions, with unavailable totals last", (id, ascending, descending) => {
    const table = makeTable();
    table.getColumn(id)!.toggleSorting(false);
    expect(ids(table)).toEqual(ascending);
    table.getColumn(id)!.toggleSorting(true);
    expect(ids(table)).toEqual(descending);
  });

  it("filters name and email separately, ignoring case and surrounding whitespace", () => {
    const table = makeTable();
    table.getColumn("name")!.setFilterValue("  STUDENT  ");
    table.getColumn("email")!.setFilterValue("BEN@");
    expect(ids(table)).toEqual(["ben"]);
    table.getColumn("name")!.setFilterValue("amy");
    expect(ids(table)).toEqual([]);
    table.resetColumnFilters(true);
    expect(ids(table)).toHaveLength(4);
  });

  it("accepts formatted phone filters without letting nonnumeric text match everyone", () => {
    const table = makeTable();
    table.getColumn("phone")!.setFilterValue("(555) 222-0000");
    expect(ids(table)).toEqual(["ben"]);
    table.getColumn("phone")!.setFilterValue("abc");
    expect(ids(table)).toEqual([]);
  });

  it.each(["total_hours", "total_credits"])("distinguishes zero student %s from unavailable staff totals", (id) => {
    const table = makeTable();
    table.getColumn(id)!.setFilterValue(["0", "0"]);
    expect(ids(table)).toEqual(["cara"]);
    table.getColumn(id)!.setFilterValue(["0", ""]);
    expect(ids(table)).toEqual(["amy", "ben", "cara"]);
  });

  it("combines role, phone, name, email and inclusive numeric ranges", () => {
    const table = makeTable();
    table.getColumn("role")!.setFilterValue(["student"]);
    table.getColumn("total_hours")!.setFilterValue(["2.5", "10"]);
    table.getColumn("total_credits")!.setFilterValue(["10", "10"]);
    table.getColumn("name")!.setFilterValue("ben");
    table.getColumn("email")!.setFilterValue("example.com");
    table.getColumn("phone")!.setFilterValue("222");
    expect(ids(table)).toEqual(["ben"]);
    table.getColumn("role")!.setFilterValue([]);
    expect(ids(table)).toEqual([]);
  });

  it("filters and sorts the entire roster before selecting a page", () => {
    const all = Array.from({ length: 125 }, (_, i) => member(String(i), { total_hours: i }));
    const table = makeTable(all, { pagination: { pageIndex: 0, pageSize: 10 } });
    table.getColumn("total_hours")!.setFilterValue(["100", ""]);
    table.getColumn("total_hours")!.toggleSorting(true);
    expect(table.getFilteredRowModel().rows).toHaveLength(25);
    expect(table.getPageCount()).toBe(3);
    expect(ids(table)[0]).toBe("124");
    table.setPageIndex(2);
    expect(ids(table)).toEqual(["104", "103", "102", "101", "100"]);
  });

  it("supports secondary sorts and clearing the view", () => {
    const table = makeTable();
    table.getColumn("role")!.toggleSorting(false);
    table.getColumn("total_hours")!.toggleSorting(true, true);
    expect(ids(table)).toEqual(["staff", "amy", "ben", "cara"]);
    table.getColumn("role")!.setFilterValue(["student"]);
    table.resetColumnFilters(true);
    table.resetSorting(true);
    expect(ids(table)).toEqual(rows.map((row) => row.id));
  });

  it("keeps global search compatible with column filters and formatted phones", () => {
    expect(searchTeam(rows, " (555) 222-0000 ")).toEqual([rows[1]]);
    expect(searchTeam(rows, " AMY@EXAMPLE.COM ")).toEqual([rows[0]]);
    expect(searchTeam(rows, "  ")).toBe(rows);
    const table = makeTable(searchTeam(rows, "STUDENT"));
    table.getColumn("total_hours")!.setFilterValue(["", "0"]);
    expect(ids(table)).toEqual(["cara"]);
  });

  it("shows readable totals without converting unavailable totals to zero", () => {
    expect(formatTeamTotal(0)).toBe("0");
    expect(formatTeamTotal(1234.25)).toBe("1,234.25");
    expect(formatTeamTotal(null)).toBe("—");
  });
});
