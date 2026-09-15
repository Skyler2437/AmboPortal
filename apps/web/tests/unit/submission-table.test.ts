import { describe, expect, it } from "vitest";
import { createTable, functionalUpdate, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel, TableState } from "@tanstack/react-table";
import { searchSubmissions, submissionDataColumns, SubmissionTableRow } from "@/lib/submissionTable";

function submission(id: string, overrides: Partial<SubmissionTableRow> = {}): SubmissionTableRow {
  return { id, user_id: id, service_date: "2026-01-01", service_type: "Family Tour", hours: 0, credits: 0, status: "Pending", feedback: null,
    users: { first_name: id, last_name: "Student", email: `${id}@example.com` }, ...overrides };
}

const rows = [
  submission("amy", { hours: 10, credits: 0 }),
  submission("ben", { service_date: "2026-01-20", service_type: "Other", hours: 2.5, credits: 2, status: "Approved" }),
  submission("cara", { service_date: "2026-02-01", service_type: "Campus Event", hours: 0, credits: 10, status: "Denied" }),
  submission("z-unlinked", { users: null, service_date: "2026-01-21", service_type: "Other", hours: 2, credits: 0.5 }),
];

function makeTable(data = rows, overrides: Partial<TableState> = {}) {
  const table = createTable<SubmissionTableRow>({
    data, columns: submissionDataColumns, state: {}, onStateChange: () => {}, renderFallbackValue: null,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
  });
  let state = { ...table.initialState, ...overrides };
  table.setOptions((options) => ({ ...options, state, onStateChange: (updater) => {
    state = functionalUpdate(updater, state);
    table.setOptions((previous) => ({ ...previous, state }));
  } }));
  return table;
}

const ids = (table: ReturnType<typeof makeTable>) => table.getRowModel().rows.map((row) => row.id);

describe("submission spreadsheet controls", () => {
  it.each([
    ["student", ["amy", "ben", "cara", "z-unlinked"], ["z-unlinked", "cara", "ben", "amy"]],
    ["service_date", ["amy", "ben", "z-unlinked", "cara"], ["cara", "z-unlinked", "ben", "amy"]],
    ["service_type", ["cara", "amy", "ben", "z-unlinked"], ["ben", "z-unlinked", "amy", "cara"]],
    ["hours", ["cara", "z-unlinked", "ben", "amy"], ["amy", "ben", "z-unlinked", "cara"]],
    ["credits", ["amy", "z-unlinked", "ben", "cara"], ["cara", "ben", "z-unlinked", "amy"]],
    ["status", ["ben", "cara", "amy", "z-unlinked"], ["amy", "z-unlinked", "cara", "ben"]],
  ] as const)("sorts %s in both directions using its actual data type", (id, ascending, descending) => {
    const table = makeTable();
    table.getColumn(id)!.toggleSorting(false);
    expect(ids(table)).toEqual(ascending);
    table.getColumn(id)!.toggleSorting(true);
    expect(ids(table)).toEqual(descending);
  });

  it("finds students by name, email, or the fallback ID without case or whitespace sensitivity", () => {
    const table = makeTable();
    table.getColumn("student")!.setFilterValue("  AMY@EXAMPLE.COM  ");
    expect(ids(table)).toEqual(["amy"]);
    table.getColumn("student")!.setFilterValue("student");
    expect(ids(table)).toEqual(["amy", "ben", "cara"]);
    table.getColumn("student")!.setFilterValue("unlinked");
    expect(ids(table)).toEqual(["z-unlinked"]);
  });

  it.each(["hours", "credits"])("preserves zero and decimal bounds when filtering %s", (id) => {
    const table = makeTable();
    table.getColumn(id)!.setFilterValue(["0", "0"]);
    expect(ids(table)).toEqual(id === "hours" ? ["cara"] : ["amy"]);
    table.getColumn(id)!.setFilterValue(id === "hours" ? ["2.5", "2.5"] : ["0.5", "0.5"]);
    expect(ids(table)).toEqual(id === "hours" ? ["ben"] : ["z-unlinked"]);
  });

  it("supports one-sided numeric limits and removes a blank range", () => {
    const table = makeTable();
    table.getColumn("hours")!.setFilterValue(["2.5", ""]);
    expect(ids(table)).toEqual(["amy", "ben"]);
    table.getColumn("hours")!.setFilterValue(["", "2"]);
    expect(ids(table)).toEqual(["cara", "z-unlinked"]);
    table.getColumn("hours")!.setFilterValue(["", ""]);
    expect(table.getState().columnFilters).toEqual([]);
    expect(ids(table)).toHaveLength(4);
  });

  it("includes both date boundaries and handles an open-ended date range", () => {
    const table = makeTable();
    table.getColumn("service_date")!.setFilterValue(["2026-01-20", "2026-01-21"]);
    expect(ids(table)).toEqual(["ben", "z-unlinked"]);
    table.getColumn("service_date")!.setFilterValue(["2026-02-01", ""]);
    expect(ids(table)).toEqual(["cara"]);
    table.getColumn("service_date")!.setFilterValue(["", "2026-01-01"]);
    expect(ids(table)).toEqual(["amy"]);
  });

  it("matches any selected value within a column and combines different column filters", () => {
    const table = makeTable();
    table.getColumn("status")!.setFilterValue(["Pending", "Approved"]);
    table.getColumn("service_type")!.setFilterValue(["Other"]);
    table.getColumn("service_date")!.setFilterValue(["2026-01-20", "2026-01-21"]);
    table.getColumn("hours")!.setFilterValue(["1", "3"]);
    table.getColumn("credits")!.setFilterValue(["", "1"]);
    expect(ids(table)).toEqual(["z-unlinked"]);
    table.getColumn("student")!.setFilterValue("ben");
    expect(ids(table)).toEqual([]);
  });

  it("keeps an empty value selection as no matches until the filter is cleared", () => {
    const table = makeTable();
    table.getColumn("status")!.setFilterValue([]);
    expect(table.getColumn("status")!.getIsFiltered()).toBe(true);
    expect(ids(table)).toEqual([]);
    table.getColumn("status")!.setFilterValue(undefined);
    expect(ids(table)).toHaveLength(4);
  });

  it("applies filters and numeric sorting before pagination across the full dataset", () => {
    const data = Array.from({ length: 125 }, (_, index) => submission(`${index}`, { hours: index }));
    const table = makeTable(data, { pagination: { pageIndex: 0, pageSize: 5 } });
    table.getColumn("hours")!.setFilterValue(["100", ""]);
    table.getColumn("hours")!.toggleSorting(true);
    expect(table.getFilteredRowModel().rows).toHaveLength(25);
    expect(table.getPageCount()).toBe(5);
    expect(ids(table)).toEqual(["124", "123", "122", "121", "120"]);
    table.setPageIndex(4);
    expect(ids(table)).toEqual(["104", "103", "102", "101", "100"]);
  });

  it("uses secondary sorts only for ties and can clear sorting and filters", () => {
    const table = makeTable();
    table.getColumn("status")!.toggleSorting(false);
    table.getColumn("hours")!.toggleSorting(false, true);
    expect(ids(table)).toEqual(["ben", "cara", "z-unlinked", "amy"]);
    table.getColumn("status")!.setFilterValue(["Pending"]);
    expect(ids(table)).toEqual(["z-unlinked", "amy"]);
    table.resetColumnFilters(true);
    table.resetSorting(true);
    expect(ids(table)).toEqual(rows.map((row) => row.id));
  });

  it("keeps the existing global search compatible with column filters", () => {
    const table = makeTable(searchSubmissions(rows, "  OTHER "));
    table.getColumn("status")!.setFilterValue(["Approved"]);
    expect(ids(table)).toEqual(["ben"]);
    expect(searchSubmissions(rows, " AMY@EXAMPLE.COM ")).toEqual([rows[0]]);
    expect(searchSubmissions(rows, "  ")).toBe(rows);
  });
});
