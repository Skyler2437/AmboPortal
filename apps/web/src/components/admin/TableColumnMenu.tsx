"use client";

import { useId, useState } from "react";
import type { Column } from "@tanstack/react-table";
import * as Popover from "@radix-ui/react-popover";
import { ArrowDown, ArrowUp, ChevronDown, Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ColumnFilterKind, RangeFilter } from "@/lib/tableFilters";

interface Props<T> {
  column: Column<T, unknown>;
  title: string;
  kind: ColumnFilterKind;
  options?: string[];
  textLabel?: string;
  textPlaceholder?: string;
}

export function TableColumnMenu<T>({ column, title, kind, options = [], textLabel, textPlaceholder }: Props<T>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [range, setRange] = useState<RangeFilter>(["", ""]);
  const [selection, setSelection] = useState<string[]>([]);
  const [optionSearch, setOptionSearch] = useState("");
  const [addSort, setAddSort] = useState(false);
  const [error, setError] = useState("");
  const sorted = column.getIsSorted();
  const filtered = column.getIsFiltered();
  const sortLabels = kind === "date" ? ["Oldest to newest", "Newest to oldest"]
    : kind === "number" ? ["Smallest to largest", "Largest to smallest"] : ["A to Z", "Z to A"];

  const onOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      const value = column.getFilterValue();
      setText(kind === "text" ? (value as string | undefined) ?? "" : "");
      setRange(kind === "date" || kind === "number" ? (value as RangeFilter | undefined) ?? ["", ""] : ["", ""]);
      setSelection(kind === "values" ? (value as string[] | undefined) ?? options : []);
      setOptionSearch("");
      setAddSort(false);
      setError("");
    }
    setOpen(nextOpen);
  };

  const applyFilter = (event: React.FormEvent) => {
    event.preventDefault();
    if (kind === "number" || kind === "date") {
      const [min, max] = range;
      if (kind === "number" && range.some((value) => value !== "" && !Number.isFinite(Number(value)))) {
        setError("Enter a valid number.");
        return;
      }
      if (min !== "" && max !== "" && (kind === "number" ? Number(min) > Number(max) : min > max)) {
        setError(kind === "date" ? "The end date must be on or after the start date." : "The maximum must be at least the minimum.");
        return;
      }
      column.setFilterValue(min === "" && max === "" ? undefined : range);
    } else if (kind === "text") {
      column.setFilterValue(text.trim() || undefined);
    } else {
      const allSelected = selection.length === options.length && options.every((option) => selection.includes(option));
      column.setFilterValue(allSelected ? undefined : selection);
    }
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`${title}: sort and filter${filtered ? ", filtered" : ""}`}
          className={cn("-ml-2 h-9 gap-1.5 px-2 font-medium shadow-none data-[state=open]:bg-white", (sorted || filtered) && "text-primary")}
        >
          {title}
          {sorted ? <>
            {sorted === "asc" ? <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />}
            <span className="text-[10px] tabular-nums" title="Sort priority">{column.getSortIndex() + 1}</span>
            <span className="sr-only">{sorted === "asc" ? "Ascending" : "Descending"}</span>
          </> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
          {filtered && <Filter className="h-3 w-3 fill-primary/20" aria-hidden="true" />}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          aria-label={`${title} options`}
          className="z-50 w-72 max-w-[calc(100vw-24px)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-xl border bg-white p-3 text-sm text-foreground shadow-lg focus:outline-none"
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 className="px-1 text-sm font-semibold">{title}</h2>
            <Popover.Close asChild><Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Close ${title} options`}><X className="h-4 w-4" /></Button></Popover.Close>
          </div>
          <div className="space-y-1 border-b pb-3">
            {sortLabels.map((label, index) => (
              <Button key={label} variant="ghost" size="sm" className="w-full justify-start gap-2 shadow-none" aria-pressed={sorted === (index ? "desc" : "asc")}
                onClick={() => { column.toggleSorting(index === 1, addSort); setOpen(false); }}>
                {index ? <ArrowDown className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}{label}
              </Button>
            ))}
            <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={addSort} onChange={(e) => setAddSort(e.target.checked)} />Add to current sort
            </label>
            {sorted && <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => { column.clearSorting(); setOpen(false); }}>Clear this sort</Button>}
          </div>
          <form onSubmit={applyFilter} className="space-y-3 pt-3">
            <p className="px-1 text-xs font-medium text-muted-foreground">Filter {title.toLowerCase()}</p>
            {kind === "text" && <div className="space-y-1.5">
              <Label htmlFor={`${id}-text`}>{textLabel ?? `${title} contains`}</Label>
              <Input id={`${id}-text`} value={text} onChange={(e) => setText(e.target.value)} placeholder={textPlaceholder ?? `Search ${title.toLowerCase()}...`} />
            </div>}
            {(kind === "number" || kind === "date") && <div className="space-y-3">
              {[0, 1].map((index) => <div key={index} className="space-y-1.5">
                <Label htmlFor={`${id}-${index}`}>{kind === "date" ? (index ? "Through" : "From") : (index ? "Maximum" : "Minimum")}</Label>
                <Input id={`${id}-${index}`} type={kind === "date" ? "date" : "number"} step={kind === "number" ? "any" : undefined}
                  value={range[index]} placeholder="No limit" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}
                  onChange={(e) => { setRange((previous) => index ? [previous[0], e.target.value] : [e.target.value, previous[1]]); setError(""); }} />
              </div>)}
              <p className="text-xs text-muted-foreground">Both limits are inclusive. Leave either blank for no limit.</p>
            </div>}
            {kind === "values" && <fieldset className="min-w-0 space-y-2">
              <legend className="sr-only">Included {title.toLowerCase()} values</legend>
              {options.length > 5 && <Input aria-label={`Search ${title.toLowerCase()} values`} placeholder="Find a value..." value={optionSearch} onChange={(e) => setOptionSearch(e.target.value)} />}
              <div className="flex items-center gap-3 text-xs">
                <button type="button" className="text-primary hover:underline" onClick={() => setSelection(options)}>Select all</button>
                <button type="button" className="text-muted-foreground hover:underline" onClick={() => setSelection([])}>Select none</button>
                <span className="ml-auto text-muted-foreground">{selection.length} selected</span>
              </div>
              <div className="max-h-48 overflow-y-auto rounded-md border p-1">
                {options.filter((option) => option.toLowerCase().includes(optionSearch.trim().toLowerCase())).map((option) => (
                  <label key={option} className="flex cursor-pointer items-start gap-2 rounded px-2 py-2 hover:bg-secondary">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={selection.includes(option)}
                      onChange={(e) => setSelection((previous) => e.target.checked ? [...previous, option] : previous.filter((value) => value !== option))} />
                    <span className="break-words">{option || "(Blank)"}</span>
                  </label>
                ))}
                {!options.some((option) => option.toLowerCase().includes(optionSearch.trim().toLowerCase())) && <p className="p-2 text-muted-foreground">No matching values.</p>}
              </div>
            </fieldset>}
            {error && <p id={`${id}-error`} role="alert" className="text-xs text-red-700">{error}</p>}
            <div className="flex items-center justify-between border-t pt-3">
              <Button type="button" variant="ghost" size="sm" disabled={!filtered} onClick={() => { column.setFilterValue(undefined); setOpen(false); }}>Clear filter</Button>
              <Button type="submit" size="sm">Apply filter</Button>
            </div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
