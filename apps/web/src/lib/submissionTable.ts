import type { ColumnDef, FilterFn } from "@tanstack/react-table";
import { dateRangeFilter, numberRangeFilter, selectedValuesFilter } from "@/lib/tableFilters";

export type SubmissionTableRow = {
  id: string;
  user_id: string;
  service_date: string;
  service_type: string;
  credits: number;
  hours: number;
  feedback: string | null;
  status: string;
  created_at?: string;
  users: { first_name: string; last_name: string; email: string } | null;
};

export const SUBMISSION_COLUMN_DETAILS = [
  { id: "student", title: "Student", kind: "text" },
  { id: "service_date", title: "Date", kind: "date" },
  { id: "service_type", title: "Type", kind: "values" },
  { id: "hours", title: "Hours", kind: "number" },
  { id: "credits", title: "Credits", kind: "number" },
  { id: "status", title: "Status", kind: "values" },
] as const;

export function studentName(row: SubmissionTableRow) {
  return row.users ? `${row.users.first_name} ${row.users.last_name}`.trim() : row.user_id;
}

export function searchSubmissions(rows: SubmissionTableRow[], query: string) {
  const search = query.trim().toLowerCase();
  if (!search) return rows;
  return rows.filter((row) =>
    [studentName(row), row.users?.email, row.service_type].some((value) => value?.toLowerCase().includes(search))
  );
}

const studentFilter: FilterFn<SubmissionTableRow> = (row, _columnId, value: string) => {
  const search = value.trim().toLowerCase();
  return [studentName(row.original), row.original.users?.email].some((text) => text?.toLowerCase().includes(search));
};
studentFilter.autoRemove = (value) => !value?.trim();

export const submissionDataColumns: ColumnDef<SubmissionTableRow>[] = [
  { id: "student", accessorFn: studentName, filterFn: studentFilter, sortingFn: "alphanumeric" },
  { accessorKey: "service_date", filterFn: dateRangeFilter, sortingFn: "text" },
  { accessorKey: "service_type", filterFn: selectedValuesFilter, sortingFn: "alphanumeric" },
  { id: "hours", accessorFn: (row) => Number(row.hours), filterFn: numberRangeFilter, sortingFn: "basic" },
  { id: "credits", accessorFn: (row) => Number(row.credits), filterFn: numberRangeFilter, sortingFn: "basic" },
  { accessorKey: "status", filterFn: selectedValuesFilter, sortingFn: "text" },
];
