"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { parseDateValue, toDateValue } from "@/lib/dateTimePicker";
import { cn } from "@/lib/utils";

export interface DatePickerCalendarProps {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  initialFocus?: boolean;
}

const MONTHS = Array.from({ length: 12 }, (_, month) =>
  new Date(2024, month, 1).toLocaleDateString("en-US", { month: "long" }),
);
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function localDate(year: number, month: number, day: number) {
  return new Date(year, month, day, 12);
}

function boundedDate(date: Date, min?: string, max?: string) {
  const minimum = min ? parseDateValue(min) : null;
  const maximum = max ? parseDateValue(max) : null;
  if (minimum && date < minimum) return minimum;
  if (maximum && date > maximum) return maximum;
  return date;
}

function initialDate(value: string, min?: string, max?: string) {
  const today = new Date();
  return boundedDate(
    parseDateValue(value) ?? localDate(today.getFullYear(), today.getMonth(), today.getDate()),
    min,
    max,
  );
}

function monthValue(date: Date) {
  return toDateValue(localDate(date.getFullYear(), date.getMonth(), 1));
}

export function DatePickerCalendar({
  value,
  onChange,
  min,
  max,
  initialFocus = true,
}: DatePickerCalendarProps) {
  const [focusedValue, setFocusedValue] = useState(() => toDateValue(initialDate(value, min, max)));
  const [visibleMonth, setVisibleMonth] = useState(() => monthValue(initialDate(value, min, max)));
  const focusedButton = useRef<HTMLButtonElement>(null);
  const shouldFocus = useRef(initialFocus);
  const titleId = useId();
  const instructionsId = useId();
  const month = parseDateValue(visibleMonth)!;
  const focusedDate = parseDateValue(focusedValue)!;
  const minimum = min ? parseDateValue(min) : null;
  const maximum = max ? parseDateValue(max) : null;
  const today = new Date();
  const todayValue = toDateValue(today);
  const tomorrowValue = toDateValue(localDate(today.getFullYear(), today.getMonth(), today.getDate() + 1));
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstYear = minimum?.getFullYear() ?? Math.min(today.getFullYear() - 100, year);
  const lastYear = maximum?.getFullYear() ?? Math.max(today.getFullYear() + 50, year);
  const years = Array.from({ length: Math.max(0, lastYear - firstYear + 1) }, (_, i) => firstYear + i);

  useEffect(() => {
    const next = initialDate(value, min, max);
    setFocusedValue(toDateValue(next));
    setVisibleMonth(monthValue(next));
  }, [value, min, max]);

  useEffect(() => {
    if (shouldFocus.current && focusedButton.current) {
      focusedButton.current.focus({ preventScroll: true });
      shouldFocus.current = false;
    }
  }, [focusedValue, visibleMonth]);

  function isDisabled(dateValue: string) {
    const date = parseDateValue(dateValue)!;
    return Boolean((minimum && date < minimum) || (maximum && date > maximum));
  }

  function isMonthDisabled(targetYear: number, targetMonth: number) {
    return Boolean(
      (minimum && localDate(targetYear, targetMonth + 1, 0) < minimum) ||
      (maximum && localDate(targetYear, targetMonth, 1) > maximum),
    );
  }

  function moveTo(date: Date, focus: boolean) {
    const next = boundedDate(date, min, max);
    shouldFocus.current = focus;
    const nextValue = toDateValue(next);
    setFocusedValue(nextValue);
    setVisibleMonth(monthValue(next));
    // A navigation key at a bound may leave state unchanged.
    if (focus && nextValue === focusedValue) {
      focusedButton.current?.focus({ preventScroll: true });
      shouldFocus.current = false;
    }
  }

  function moveMonth(targetYear: number, targetMonth: number, focus = false) {
    const lastDay = localDate(targetYear, targetMonth + 1, 0).getDate();
    moveTo(localDate(targetYear, targetMonth, Math.min(focusedDate.getDate(), lastDay)), focus);
  }

  function handleDayKeyDown(event: KeyboardEvent<HTMLButtonElement>, date: Date) {
    let dayOffset: number | undefined;
    switch (event.key) {
      case "ArrowLeft": dayOffset = -1; break;
      case "ArrowRight": dayOffset = 1; break;
      case "ArrowUp": dayOffset = -7; break;
      case "ArrowDown": dayOffset = 7; break;
      case "Home": dayOffset = -date.getDay(); break;
      case "End": dayOffset = 6 - date.getDay(); break;
      case "PageUp":
      case "PageDown": {
        event.preventDefault();
        const offset = (event.key === "PageUp" ? -1 : 1) * (event.shiftKey ? 12 : 1);
        const targetMonth = date.getMonth() + offset;
        const lastDay = localDate(date.getFullYear(), targetMonth + 1, 0).getDate();
        moveTo(localDate(date.getFullYear(), targetMonth, Math.min(date.getDate(), lastDay)), true);
        return;
      }
      default: return;
    }
    event.preventDefault();
    moveTo(localDate(date.getFullYear(), date.getMonth(), date.getDate() + dayOffset), true);
  }

  const firstGridDay = localDate(year, monthIndex, 1 - month.getDay());
  const weekCount = Math.ceil((month.getDay() + localDate(year, monthIndex + 1, 0).getDate()) / 7);
  const days = Array.from({ length: weekCount * 7 }, (_, i) =>
    localDate(firstGridDay.getFullYear(), firstGridDay.getMonth(), firstGridDay.getDate() + i),
  );
  const navigationClass = "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-30";
  const selectClass = "h-9 min-w-0 cursor-pointer rounded-lg border border-transparent bg-transparent px-1 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-100 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <div className="w-full bg-white text-slate-900">
      <div className="mb-2 flex items-center gap-1">
        <button type="button" className={navigationClass} aria-label="Previous month" disabled={isMonthDisabled(year, monthIndex - 1)} onClick={() => moveMonth(year, monthIndex - 1)}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <select aria-label="Month" value={monthIndex} onChange={(event) => moveMonth(year, Number(event.target.value))} className={cn(selectClass, "flex-1")}>
          {MONTHS.map((name, index) => <option key={name} value={index} disabled={isMonthDisabled(year, index)}>{name}</option>)}
        </select>
        <select aria-label="Year" value={year} onChange={(event) => moveMonth(Number(event.target.value), monthIndex)} className={cn(selectClass, "w-[72px]")}>
          {years.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <button type="button" className={navigationClass} aria-label="Next month" disabled={isMonthDisabled(year, monthIndex + 1)} onClick={() => moveMonth(year, monthIndex + 1)}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <p id={titleId} className="sr-only" aria-live="polite">{MONTHS[monthIndex]} {year}</p>
      <p id={instructionsId} className="sr-only">Use arrow keys to navigate dates, Home and End for the start and end of the week, and Page Up and Page Down to change months. Press Enter or Space to select a date.</p>
      <div role="grid" aria-labelledby={titleId} aria-describedby={instructionsId}>
        <div role="row" className="mb-1 grid grid-cols-7 gap-1">
          {WEEKDAYS.map((day) => <div key={day} role="columnheader" aria-label={day} className="flex h-7 items-center justify-center text-[11px] font-medium text-slate-400">{day.slice(0, 2)}</div>)}
        </div>
        {Array.from({ length: weekCount }, (_, week) => (
          <div key={week} role="row" className="grid grid-cols-7 gap-1">
            {days.slice(week * 7, week * 7 + 7).map((date) => {
              const dateValue = toDateValue(date);
              const selected = dateValue === value;
              const isToday = dateValue === todayValue;
              const outsideMonth = date.getMonth() !== monthIndex;
              const weekend = date.getDay() === 0 || date.getDay() === 6;
              const disabled = isDisabled(dateValue);
              return (
                <div key={dateValue} role="gridcell" aria-selected={selected} className="flex items-center justify-center">
                  <button
                    ref={dateValue === focusedValue ? focusedButton : undefined}
                    type="button"
                    tabIndex={dateValue === focusedValue ? 0 : -1}
                    disabled={disabled}
                    aria-label={date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                    aria-current={isToday ? "date" : undefined}
                    onFocus={() => setFocusedValue(dateValue)}
                    onClick={() => {
                      // Adjacent-month days move to a new grid row on selection.
                      // Restore focus to their replacement button in the new month.
                      if (outsideMonth) {
                        shouldFocus.current = true;
                        setVisibleMonth(monthValue(date));
                      }
                      onChange(dateValue);
                    }}
                    onKeyDown={(event) => handleDayKeyDown(event, date)}
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-lg text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-25 sm:h-8",
                      selected ? "bg-primary font-semibold text-white shadow-sm hover:bg-primary/90" : "hover:bg-slate-100",
                      !selected && (outsideMonth ? "text-slate-300" : weekend ? "text-slate-500" : "text-slate-800"),
                      isToday && !selected && "font-semibold text-primary ring-1 ring-inset ring-primary/30",
                    )}
                  >
                    {date.getDate()}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3">
        {[{ label: "Today", date: todayValue }, { label: "Tomorrow", date: tomorrowValue }].map((shortcut) => (
          <button key={shortcut.label} type="button" disabled={isDisabled(shortcut.date)} onClick={() => onChange(shortcut.date)} className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40">
            {shortcut.label}
          </button>
        ))}
      </div>
    </div>
  );
}
