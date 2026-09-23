"use client";

import { useEffect, useId, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { CalendarDays, ChevronDown, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePickerCalendar } from "@/components/DatePickerCalendar";
import {
  FIVE_MINUTE_OPTIONS, formatPickerDate, formatPickerTime,
  isPickerValueInRange, roundDateTimeToFiveMinutes,
} from "@/lib/dateTimePicker";
import { cn } from "@/lib/utils";

type DateTimePickerProps = {
  mode?: "date" | "datetime";
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  min?: string;
  max?: string;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
};

const timeSelectClass = "h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-sm font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

/** Uses local YYYY-MM-DD[THH:mm] values, matching the native fields it replaces. */
export function DateTimePicker({
  mode = "datetime", id, name, value, defaultValue = "", onChange,
  required = false, disabled = false, min, max, className,
  "aria-label": ariaLabel, "aria-describedby": ariaDescribedBy,
}: DateTimePickerProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const [internalValue, setInternalValue] = useState(defaultValue);
  const currentValue = value ?? internalValue;
  const [open, setOpen] = useState(false);
  const [draftDate, setDraftDate] = useState("");
  const [draftTime, setDraftTime] = useState("12:00");
  const [error, setError] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const withTime = mode === "datetime";
  const [selectedDate, selectedTime] = currentValue.split("T");
  const [hour, minute] = draftTime.split(":");
  const draftValue = draftDate ? `${draftDate}T${draftTime}` : "";
  const draftInRange = !draftValue || isPickerValueInRange(draftValue, min, max);

  useEffect(() => {
    const message = currentValue && !isPickerValueInRange(currentValue, min, max)
      ? "Choose a date within the allowed range." : "";
    inputRef.current?.setCustomValidity(message);
  }, [currentValue, min, max]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function changeOpen(nextOpen: boolean) {
    if (disabled) return;
    if (nextOpen) {
      const draft = withTime ? roundDateTimeToFiveMinutes(currentValue) : currentValue;
      const [date = "", time = "12:00"] = draft.split("T");
      setDraftDate(date);
      setDraftTime(time);
    }
    setOpen(nextOpen);
  }

  function commit(nextValue: string) {
    if (disabled) return;
    setInternalValue(nextValue);
    onChange?.(nextValue);
    setError("");
    setOpen(false);
  }

  function updateTime(part: "hour" | "minute" | "period", nextValue: string) {
    let nextHour = Number(hour);
    let nextMinute = minute;
    if (part === "hour") nextHour = Number(nextValue) % 12 + (nextHour >= 12 ? 12 : 0);
    if (part === "minute") nextMinute = nextValue;
    if (part === "period") nextHour = nextHour % 12 + (nextValue === "PM" ? 12 : 0);
    setDraftTime(`${String(nextHour).padStart(2, "0")}:${nextMinute}`);
  }

  return (
    <div className={cn("relative min-w-0", className)}>
      {/* Keep native form data/required validation while the visible control is a button. */}
      <input
        ref={inputRef}
        type="text"
        name={name}
        value={currentValue}
        onChange={() => {}}
        required={required}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onInvalid={event => {
          event.preventDefault();
          setError(currentValue ? "Choose a date within the allowed range." : `Choose a date${withTime ? " and time" : ""}.`);
          triggerRef.current?.focus();
        }}
      />
      <Popover.Root open={open} onOpenChange={changeOpen}>
        <Popover.Trigger asChild>
          <button
            ref={triggerRef}
            id={fieldId}
            type="button"
            disabled={disabled}
            aria-label={ariaLabel}
            aria-describedby={[`${fieldId}-value`, ariaDescribedBy, error ? `${fieldId}-error` : ""].filter(Boolean).join(" ")}
            className={cn(
              "flex min-h-11 w-full items-center gap-2.5 rounded-lg border border-input bg-background px-3 py-2 text-left text-sm shadow-sm transition-colors hover:border-primary/50 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
              open && "border-primary/50 ring-2 ring-primary/10",
              error && "border-destructive",
            )}
          >
            <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span id={`${fieldId}-value`} className={cn("flex flex-1 flex-wrap items-center gap-x-2 gap-y-0.5", !currentValue && "text-muted-foreground")}>
              <span>{currentValue ? formatPickerDate(selectedDate) : `Choose date${withTime ? " & time" : ""}`}</span>
              {withTime && selectedTime && <span className="whitespace-nowrap text-muted-foreground">{formatPickerTime(selectedTime)}</span>}
            </span>
            <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={8}
            collisionPadding={12}
            aria-label={withTime ? "Choose date and time" : "Choose date"}
            className={cn("z-[100] w-[320px] max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border bg-popover text-popover-foreground shadow-xl outline-none max-h-[var(--radix-popover-content-available-height)]", withTime && "sm:w-[540px]")}
            onOpenAutoFocus={event => event.preventDefault()}
          >
            <div className={cn(withTime && "sm:flex")}>
              <div className={cn("p-3", withTime && "sm:w-[316px] sm:shrink-0")}>
                <DatePickerCalendar
                  value={draftDate}
                  onChange={date => withTime ? setDraftDate(date) : commit(date)}
                  min={min?.split("T")[0]}
                  max={max?.split("T")[0]}
                />
              </div>
              {withTime && <div className="space-y-3 border-t bg-muted/25 px-4 py-3 sm:flex-1 sm:border-l sm:border-t-0 sm:py-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium"><Clock3 aria-hidden="true" className="h-4 w-4 text-muted-foreground" />Time</span>
                  <span className="text-xs text-muted-foreground">5-minute steps</span>
                </div>
                <p className="hidden text-sm text-muted-foreground sm:block">{draftDate ? formatPickerDate(draftDate) : "Choose a date on the calendar."}</p>
                <div className="flex items-center gap-2">
                  <select aria-label="Hour" className={timeSelectClass} value={String(Number(hour) % 12 || 12)} onChange={event => updateTime("hour", event.target.value)}>
                    {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={String(i + 1)}>{String(i + 1).padStart(2, "0")}</option>)}
                  </select>
                  <span aria-hidden="true" className="font-medium text-muted-foreground">:</span>
                  <select aria-label="Minute" className={timeSelectClass} value={minute} onChange={event => updateTime("minute", event.target.value)}>
                    {FIVE_MINUTE_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <select aria-label="AM or PM" className={timeSelectClass} value={Number(hour) >= 12 ? "PM" : "AM"} onChange={event => updateTime("period", event.target.value)}>
                    <option value="AM">AM</option><option value="PM">PM</option>
                  </select>
                </div>
                {!draftInRange && <p role="alert" className="text-xs text-destructive">Choose a time within the allowed range.</p>}
              </div>}
            </div>
            <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t bg-popover px-3 py-2.5">
              <Button type="button" variant="ghost" size="sm" disabled={!currentValue} onClick={() => commit("")}>Clear</Button>
              {withTime ? <Button type="button" size="sm" disabled={!draftDate || !draftInRange} onClick={() => commit(draftValue)}>Done</Button>
                : <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {error && <p id={`${fieldId}-error`} role="alert" className="mt-1.5 text-xs text-destructive">{error}</p>}
    </div>
  );
}
