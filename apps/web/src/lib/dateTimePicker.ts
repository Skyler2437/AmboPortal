export const FIVE_MINUTE_OPTIONS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

/** Date-only values must stay in local calendar time, never pass through UTC. */
export function toDateValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseDateValue(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  return toDateValue(date) === value ? date : null;
}

export function formatPickerDate(value: string): string {
  return parseDateValue(value)?.toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  }) ?? "";
}

export function formatPickerTime(value: string): string {
  const [hour, minute] = value.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

/** Round only a new editing draft; opening/cancelling never alters saved data. */
export function roundDateTimeToFiveMinutes(value: string): string {
  const [day, time] = value.split("T");
  const date = parseDateValue(day);
  if (!date || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time ?? "")) return "";
  const [hour, minute] = time.split(":").map(Number);
  const totalMinutes = Math.ceil((hour * 60 + minute) / 5) * 5;
  // Work with wall-clock minutes so a DST transition does not shift the choice.
  if (totalMinutes === 1440) date.setDate(date.getDate() + 1);
  return `${toDateValue(date)}T${String(Math.floor(totalMinutes / 60) % 24).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

export function isPickerValueInRange(value: string, min?: string, max?: string): boolean {
  return (!min || value >= min) && (!max || value <= max);
}
