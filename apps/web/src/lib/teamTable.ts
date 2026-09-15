import type { ColumnDef, FilterFn } from "@tanstack/react-table";
import { containsTextFilter, numberRangeFilter, selectedValuesFilter } from "@/lib/tableFilters";

export type TeamTableRow = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  role: string;
  total_hours: number | null;
  total_credits: number | null;
};

export const TEAM_COLUMN_DETAILS = [
  { id: "name", title: "Name", kind: "text" },
  { id: "email", title: "Email", kind: "text" },
  { id: "phone", title: "Phone", kind: "text" },
  { id: "role", title: "Role", kind: "values" },
  { id: "total_hours", title: "Total hours", kind: "number" },
  { id: "total_credits", title: "Total credits", kind: "number" },
] as const;

export const teamMemberName = (row: TeamTableRow) => `${row.first_name} ${row.last_name}`.trim();
const phoneDigits = (value: string) => value.replace(/\D/g, "");

export function searchTeam(rows: TeamTableRow[], query: string) {
  const search = query.trim().toLowerCase();
  if (!search) return rows;
  const phoneSearch = /^[\d\s()+.-]+$/.test(search) ? phoneDigits(search) : "";
  return rows.filter((row) =>
    [teamMemberName(row), row.email, row.phone, row.role].some((value) => value?.toLowerCase().includes(search))
    || (phoneSearch && phoneDigits(row.phone).includes(phoneSearch))
  );
}

const phoneFilter: FilterFn<TeamTableRow> = (row, id, query: string) => {
  const digits = phoneDigits(query);
  return !!digits && phoneDigits(row.getValue<string>(id)).includes(digits);
};
phoneFilter.autoRemove = (value) => !value?.trim();

export const teamDataColumns: ColumnDef<TeamTableRow>[] = [
  { id: "name", accessorFn: teamMemberName, filterFn: containsTextFilter, sortingFn: "alphanumeric" },
  { accessorKey: "email", filterFn: containsTextFilter, sortingFn: "text" },
  { accessorKey: "phone", filterFn: phoneFilter, sortingFn: "text" },
  { accessorKey: "role", filterFn: selectedValuesFilter, sortingFn: "text" },
  { id: "total_hours", accessorFn: (row) => row.total_hours ?? undefined, filterFn: numberRangeFilter, sortingFn: "basic", sortUndefined: "last" },
  { id: "total_credits", accessorFn: (row) => row.total_credits ?? undefined, filterFn: numberRangeFilter, sortingFn: "basic", sortUndefined: "last" },
];

const totalFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
export const formatTeamTotal = (value: number | null) => value == null ? "—" : totalFormatter.format(value);
