"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { tintForStatus } from "@/lib/eventColors";
import type { EventDetails } from "@ambo/database/types";
import type { EventDetailsWithMyRsvp } from "@/components/EventCalendar";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MAX_CHIPS_PER_DAY = 3;

function EventChip({
    event,
    onEventClick,
}: {
    event: EventDetailsWithMyRsvp;
    onEventClick: (e: EventDetails) => void;
}) {
    const tint = tintForStatus(event.my_rsvp_status);
    const hasTint = !!event.my_rsvp_status;
    return (
        <button
            type="button"
            onClick={() => onEventClick(event)}
            title={event.title}
            className={cn(
                "block w-full truncate rounded border px-1.5 py-0.5 text-left text-xs font-medium hover:opacity-80",
                !hasTint && "bg-secondary text-secondary-foreground border-transparent"
            )}
            style={hasTint ? { backgroundColor: tint.bg, borderColor: tint.border, color: tint.accent } : undefined}
        >
            {event.title}
        </button>
    );
}

export function EventMonthCalendar({
    events,
    onEventClick,
}: {
    events: EventDetailsWithMyRsvp[];
    onEventClick: (e: EventDetails) => void;
}) {
    const [viewDate, setViewDate] = useState(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1);
    });

    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();

    const startOffset = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cellCount = Math.ceil((startOffset + daysInMonth) / 7) * 7;

    // API order (start_time asc) is preserved within each day.
    const eventsByDay = new Map<string, EventDetailsWithMyRsvp[]>();
    for (const ev of events) {
        const key = new Date(ev.start_time).toDateString();
        const list = eventsByDay.get(key);
        if (list) list.push(ev);
        else eventsByDay.set(key, [ev]);
    }

    const todayKey = new Date().toDateString();

    const goToToday = () => {
        const now = new Date();
        setViewDate(new Date(now.getFullYear(), now.getMonth(), 1));
    };

    return (
        <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center justify-between">
                <h2 className="text-lg font-semibold">
                    {viewDate.toLocaleDateString([], { month: "long", year: "numeric" })}
                </h2>
                <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" onClick={goToToday}>
                        Today
                    </Button>
                    <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setViewDate(new Date(year, month - 1, 1))}
                        aria-label="Previous month"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setViewDate(new Date(year, month + 1, 1))}
                        aria-label="Next month"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            <div className="grid shrink-0 grid-cols-7 text-center text-xs font-medium text-muted-foreground py-2">
                {WEEKDAYS.map((day) => (
                    <div key={day}>{day}</div>
                ))}
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-7 auto-rows-fr border-t border-l rounded-lg overflow-hidden">
                {Array.from({ length: cellCount }, (_, i) => {
                    const cellDate = new Date(year, month, 1 - startOffset + i);
                    const key = cellDate.toDateString();
                    const dayEvents = eventsByDay.get(key) ?? [];
                    const inMonth = cellDate.getMonth() === month;
                    const isToday = key === todayKey;
                    const overflow = dayEvents.length - MAX_CHIPS_PER_DAY;

                    return (
                        <div
                            key={key}
                            className={cn("min-h-0 overflow-hidden border-b border-r p-1 space-y-1", !inMonth && "bg-muted/30")}
                        >
                            {isToday ? (
                                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                                    {cellDate.getDate()}
                                </span>
                            ) : (
                                <span className={cn("inline-block text-xs px-1 py-1", !inMonth && "text-muted-foreground")}>
                                    {cellDate.getDate()}
                                </span>
                            )}
                            {dayEvents.slice(0, MAX_CHIPS_PER_DAY).map((ev) => (
                                <EventChip key={ev.id} event={ev} onEventClick={onEventClick} />
                            ))}
                            {overflow > 0 && (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <button
                                            type="button"
                                            className="block w-full text-left px-1.5 text-xs text-muted-foreground hover:text-foreground"
                                        >
                                            +{overflow} more
                                        </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start">
                                        {dayEvents.map((ev) => (
                                            <DropdownMenuItem key={ev.id} onClick={() => onEventClick(ev)}>
                                                <span className="text-xs text-muted-foreground shrink-0">
                                                    {new Date(ev.start_time).toLocaleTimeString([], {
                                                        hour: "numeric",
                                                        minute: "2-digit",
                                                    })}
                                                </span>
                                                <span className="truncate">{ev.title}</span>
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
