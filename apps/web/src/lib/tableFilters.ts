import type { Row } from "@tanstack/react-table";

export type RangeFilter = [string, string];
export type ColumnFilterKind = "text" | "date" | "number" | "values";

export function containsTextFilter<T>(row: Row<T>, id: string, value: string) {
  return String(row.getValue(id) ?? "").toLowerCase().includes(value.trim().toLowerCase());
}
containsTextFilter.autoRemove = (value?: string) => !value?.trim();

const rangeIsEmpty = (value?: RangeFilter) => !value || (value[0] === "" && value[1] === "");

export function numberRangeFilter<T>(row: Row<T>, id: string, [min, max]: RangeFilter) {
  const raw = row.getValue(id);
  if (raw == null) return false;
  const value = Number(raw);
  return Number.isFinite(value) && (min === "" || value >= Number(min)) && (max === "" || value <= Number(max));
}
numberRangeFilter.autoRemove = rangeIsEmpty;

export function dateRangeFilter<T>(row: Row<T>, id: string, [from, to]: RangeFilter) {
  // Date-only ISO strings sort chronologically without a timezone conversion.
  const date = row.getValue<string>(id);
  return (!from || date >= from) && (!to || date <= to);
}
dateRangeFilter.autoRemove = rangeIsEmpty;

export function selectedValuesFilter<T>(row: Row<T>, id: string, values: string[]) {
  return values.includes(row.getValue(id));
}
// An empty selection intentionally matches no rows; clearing uses undefined.
selectedValuesFilter.autoRemove = (value?: string[]) => value == null;

export function describeColumnFilter(kind: ColumnFilterKind, value: unknown): string {
  if (kind === "text") return String(value);
  if (kind === "values") {
    const values = value as string[];
    return values.length ? values.join(", ") : "No values selected";
  }
  const [min, max] = value as RangeFilter;
  if (min && max && min === max) return min;
  if (min && max) return `${min} – ${max}`;
  if (kind === "date") return min ? `From ${min}` : `Through ${max}`;
  return min ? `At least ${min}` : `At most ${max}`;
}
