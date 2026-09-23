import { describe, expect, it } from "vitest";
import {
  formatPickerDate,
  formatPickerTime,
  isPickerValueInRange,
  parseDateValue,
  roundDateTimeToFiveMinutes,
  toDateValue,
} from "@/lib/dateTimePicker";

describe("picker calendar values", () => {
  it("keeps a calendar date unchanged on either side of UTC", () => {
    const originalTimezone = process.env.TZ;
    try {
      for (const timezone of ["America/Los_Angeles", "Pacific/Auckland"]) {
        process.env.TZ = timezone;
        const localDate = new Date(2026, 8, 23, 0, 5);
        expect(toDateValue(localDate)).toBe("2026-09-23");
        const parsed = parseDateValue("2026-09-23");
        expect(parsed).not.toBeNull();
        expect(parsed!.getFullYear()).toBe(2026);
        expect(parsed!.getMonth()).toBe(8);
        expect(parsed!.getDate()).toBe(23);
        expect(formatPickerDate("2026-09-23")).toBe("Sep 23, 2026");
      }
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it("accepts leap days only when the year has one and rejects rolled-over dates", () => {
    expect(toDateValue(parseDateValue("2028-02-29")!)).toBe("2028-02-29");
    for (const value of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-09-00", "9/23/2026", ""]) {
      expect(parseDateValue(value)).toBeNull();
    }
  });
});

describe("five-minute editing drafts", () => {
  it.each([
    ["2026-09-23T09:01", "2026-09-23T09:05"],
    ["2026-09-23T09:58", "2026-09-23T10:00"],
    ["2026-09-23T23:59", "2026-09-24T00:00"],
    ["2026-09-30T23:56", "2026-10-01T00:00"],
    ["2026-12-31T23:58", "2027-01-01T00:00"],
    ["2028-02-28T23:57", "2028-02-29T00:00"],
    ["2028-02-29T23:59", "2028-03-01T00:00"],
  ])("rounds %s forward to %s", (value, expected) => {
    expect(roundDateTimeToFiveMinutes(value)).toBe(expected);
  });

  it.each(["2026-09-23T00:00", "2026-09-23T09:05", "2026-09-23T12:30", "2026-09-23T23:55"])(
    "preserves the already valid time %s",
    value => expect(roundDateTimeToFiveMinutes(value)).toBe(value),
  );

  it.each(["", "2026-09-23", "2026-02-29T09:05", "2026-09-23T24:00", "2026-09-23T09:60"])(
    "does not invent a draft from invalid input %s",
    value => expect(roundDateTimeToFiveMinutes(value)).toBe(""),
  );
});

describe("picker limits", () => {
  it("allows exact date boundaries while excluding a future service date", () => {
    expect(isPickerValueInRange("2026-09-23", undefined, "2026-09-23")).toBe(true);
    expect(isPickerValueInRange("2026-09-24", undefined, "2026-09-23")).toBe(false);
    expect(isPickerValueInRange("2026-09-01", "2026-09-01", "2026-09-23")).toBe(true);
    expect(isPickerValueInRange("2026-08-31", "2026-09-01", "2026-09-23")).toBe(false);
  });

  it("checks time as well as date at a scheduling boundary", () => {
    const minimum = "2026-09-23T09:05";
    const maximum = "2026-09-24T16:30";
    expect(isPickerValueInRange(minimum, minimum, maximum)).toBe(true);
    expect(isPickerValueInRange(maximum, minimum, maximum)).toBe(true);
    expect(isPickerValueInRange("2026-09-23T09:00", minimum, maximum)).toBe(false);
    expect(isPickerValueInRange("2026-09-24T16:35", minimum, maximum)).toBe(false);
    expect(isPickerValueInRange("2026-09-24T10:00", minimum, maximum)).toBe(true);
  });
});

describe("readable time labels", () => {
  it.each([
    ["00:00", "12:00 AM"],
    ["00:05", "12:05 AM"],
    ["12:00", "12:00 PM"],
    ["12:05", "12:05 PM"],
    ["09:30", "9:30 AM"],
    ["23:55", "11:55 PM"],
  ])("labels %s as %s", (value, expected) => {
    expect(formatPickerTime(value)).toBe(expected);
  });
});
