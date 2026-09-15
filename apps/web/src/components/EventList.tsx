"use client";

import { CalendarDays, CheckCircle2, ChevronRight, HelpCircle, XCircle } from "lucide-react";
import type { EventDetails } from "@ambo/database/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { EventDetailsWithMyRsvp } from "@/components/EventCalendar";
import { eventsForList, type EventListRange } from "@/lib/eventList";
import { cn } from "@/lib/utils";

const ROW_GRID = "grid grid-cols-[4.75rem_minmax(0,1fr)_1rem] items-center gap-x-3 px-4 md:grid-cols-[8rem_minmax(0,1fr)_11rem_6.5rem_1rem] md:gap-x-4 md:px-5";
const RANGES: { value: EventListRange; label: string }[] = [
    { value: "upcoming", label: "Upcoming" },
    { value: "past", label: "Past" },
    { value: "all", label: "All events" },
];
const RSVP_STYLES = {
    going: { label: "Going", icon: CheckCircle2, className: "bg-emerald-50 text-emerald-800" },
    maybe: { label: "Maybe", icon: HelpCircle, className: "bg-amber-50 text-amber-800" },
    no: { label: "Can't go", icon: XCircle, className: "bg-slate-100 text-slate-600" },
};

function RsvpLabel({ status }: { status?: string | null }) {
    const config = status === "going" || status === "maybe" || status === "no" ? RSVP_STYLES[status] : null;
    if (!config) return <span className="text-xs text-muted-foreground">No response</span>;
    const Icon = config.icon;
    return (
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium", config.className)}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {config.label}
        </span>
    );
}

function eventTime(event: EventDetails) {
    const start = new Date(event.start_time);
    const end = new Date(event.end_time);
    const options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
    const endDate = start.toDateString() === end.toDateString()
        ? ""
        : `${end.toLocaleDateString([], { month: "short", day: "numeric", ...(start.getFullYear() !== end.getFullYear() ? { year: "numeric" as const } : {}) })}, `;
    return `${start.toLocaleTimeString([], options)} – ${endDate}${end.toLocaleTimeString([], options)}`;
}

export function EventList({
    events,
    loading,
    range,
    onRangeChange,
    onEventClick,
}: {
    events: EventDetailsWithMyRsvp[];
    loading: boolean;
    range: EventListRange;
    onRangeChange: (range: EventListRange) => void;
    onEventClick: (event: EventDetails) => void;
}) {
    const visibleEvents = eventsForList(events, range);
    const hasPastEvents = eventsForList(events, "past").length > 0;

    return (
        <section className="space-y-3" aria-label="Event list">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-1" role="group" aria-label="Event date range">
                    {RANGES.map((item) => (
                        <Button
                            key={item.value}
                            variant={range === item.value ? "secondary" : "ghost"}
                            size="sm"
                            aria-pressed={range === item.value}
                            onClick={() => onRangeChange(item.value)}
                            className="h-10 px-3 md:h-9"
                        >
                            {item.label}
                        </Button>
                    ))}
                </div>
                <p className="text-xs text-muted-foreground" aria-live="polite">
                    {loading ? "Loading events…" : `${visibleEvents.length} ${visibleEvents.length === 1 ? "event" : "events"}`}
                </p>
            </div>

            <div className="overflow-hidden rounded-lg border bg-background" aria-busy={loading}>
                <div className={cn(ROW_GRID, "hidden border-b bg-muted/30 py-2.5 text-xs font-medium text-muted-foreground md:grid")} aria-hidden="true">
                    <span>Date</span><span>Event</span><span>Time</span><span>Your RSVP</span><span />
                </div>
                {loading ? (
                    <div className="divide-y" role="status" aria-label="Loading event list">
                        {[0, 1, 2, 3, 4].map((row) => (
                            <div key={row} className={cn(ROW_GRID, "min-h-24 py-4 md:min-h-20")}>
                                <Skeleton className="h-9 w-14" />
                                <div className="space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /></div>
                                <Skeleton className="hidden h-4 w-32 md:block" />
                                <Skeleton className="hidden h-6 w-20 rounded-full md:block" />
                            </div>
                        ))}
                    </div>
                ) : visibleEvents.length > 0 ? (
                    <ul className="divide-y">
                        {visibleEvents.map((event) => {
                            const date = new Date(event.start_time);
                            const time = eventTime(event);
                            return (
                                <li key={event.id}>
                                    <button
                                        type="button"
                                        onClick={() => onEventClick(event)}
                                        aria-label={`View ${event.title}, ${date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })}, ${time}`}
                                        className={cn(ROW_GRID, "group min-h-24 w-full py-4 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary md:min-h-20")}
                                    >
                                        <time dateTime={event.start_time} className="self-start pt-0.5 md:self-center md:pt-0">
                                            <span className="block text-sm font-semibold">{date.toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                                            <span className="mt-1 block text-xs text-muted-foreground">{date.toLocaleDateString([], { weekday: "short" })}, {date.getFullYear()}</span>
                                        </time>
                                        <span className="min-w-0">
                                            <span className="block break-words text-sm font-medium group-hover:text-primary">{event.title}</span>
                                            {event.description && <span className="mt-1 line-clamp-1 text-sm text-muted-foreground">{event.description}</span>}
                                            <span className="mt-2 block text-xs text-muted-foreground md:hidden">{time}</span>
                                            {event.my_rsvp_status && <span className="mt-2 block md:hidden"><RsvpLabel status={event.my_rsvp_status} /></span>}
                                        </span>
                                        <span className="hidden text-sm tabular-nums text-muted-foreground md:block">{time}</span>
                                        <span className="hidden md:block"><RsvpLabel status={event.my_rsvp_status} /></span>
                                        <ChevronRight className="h-4 w-4 text-muted-foreground/60 group-hover:text-primary" aria-hidden="true" />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <div className="px-4 py-12 text-center">
                        <CalendarDays className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
                        <h2 className="text-sm font-medium">{range === "upcoming" ? "No upcoming events" : range === "past" ? "No past events" : "No events yet"}</h2>
                        <p className="mt-1 text-sm text-muted-foreground">{range === "past" ? "Completed events will appear here." : "Check back later for new events."}</p>
                        {range === "upcoming" && hasPastEvents && <Button variant="outline" size="sm" onClick={() => onRangeChange("past")} className="mt-4">View past events</Button>}
                    </div>
                )}
            </div>
        </section>
    );
}
