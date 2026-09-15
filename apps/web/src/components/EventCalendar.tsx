"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarDays, LayoutList, RefreshCw, AlertTriangle } from "lucide-react";
import type { EventDetails } from "@ambo/database/types";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-media-query";
import { EventMonthCalendar } from "@/components/EventMonthCalendar";
import { EventList } from "@/components/EventList";
import type { EventListRange } from "@/lib/eventList";

export type EventDetailsWithMyRsvp = EventDetails & {
    my_rsvp_status?: string | null;
    my_rsvp_option_id?: string | null;
};

type EventsView = "list" | "calendar";
const VIEW_STORAGE_KEY = "events_view_pref";

export function EventCalendar({
    onEventClick,
    onRefreshRef,
}: {
    onEventClick: (e: EventDetails) => void;
    onRefreshRef?: (fn: () => void) => void;
}) {
    const [events, setEvents] = useState<EventDetailsWithMyRsvp[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [view, setView] = useState<EventsView>("calendar");
    const [listRange, setListRange] = useState<EventListRange>("upcoming");
    const isDesktop = useMediaQuery("(min-width: 768px)");
    const effectiveView = isDesktop ? view : "list";

    useEffect(() => {
        try {
            const stored = localStorage.getItem(VIEW_STORAGE_KEY);
            // Keep existing card-view preferences when upgrading to the list.
            if (stored === "card" || stored === "list") setView("list");
            else if (stored === "calendar") setView("calendar");
        } catch {}
    }, []);

    const setViewPref = (value: EventsView) => {
        setView(value);
        try {
            localStorage.setItem(VIEW_STORAGE_KEY, value);
        } catch {}
    };

    const fetchEvents = useCallback(async () => {
        try {
            const res = await fetch("/api/events");
            if (!res.ok) throw new Error("Failed to fetch events");
            const data = await res.json();
            setEvents(data.events || []);
            setError(false);
        } catch (e) {
            console.error("Failed to fetch events", e);
            setError(true);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void fetchEvents();
        const interval = setInterval(fetchEvents, 30000);
        return () => clearInterval(interval);
    }, [fetchEvents]);

    useEffect(() => {
        onRefreshRef?.(fetchEvents);
    }, [onRefreshRef, fetchEvents]);

    return (
        <div className={cn(
            effectiveView === "calendar"
                ? "flex h-[calc(100dvh-8rem)] min-h-[32rem] flex-col gap-4"
                : "space-y-4"
        )}>
            <div className="flex min-h-10 shrink-0 items-center justify-between gap-4">
                <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
                <div className="hidden items-center gap-1 rounded-lg border bg-muted/40 p-1 md:flex" role="group" aria-label="Event view">
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-pressed={view === "list"}
                        onClick={() => setViewPref("list")}
                        className={cn("h-8 gap-1.5", view === "list" && "bg-background shadow-sm")}
                    >
                        <LayoutList className="h-4 w-4" aria-hidden="true" />
                        List
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-pressed={view === "calendar"}
                        onClick={() => setViewPref("calendar")}
                        className={cn("h-8 gap-1.5", view === "calendar" && "bg-background shadow-sm")}
                    >
                        <CalendarDays className="h-4 w-4" aria-hidden="true" />
                        Calendar
                    </Button>
                </div>
            </div>

            {error && events.length === 0 ? (
                <div className="rounded-lg border bg-background py-12 text-center" role="alert">
                    <AlertTriangle className="mx-auto mb-3 h-7 w-7 text-red-500" aria-hidden="true" />
                    <h2 className="font-medium">Failed to load events</h2>
                    <p className="mb-4 mt-1 text-sm text-muted-foreground">Please check your connection and try again.</p>
                    <Button variant="outline" size="sm" onClick={fetchEvents}>
                        <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                        Retry
                    </Button>
                </div>
            ) : effectiveView === "calendar" ? (
                <div className="min-h-0 flex-1">
                    {loading ? (
                        <div className="flex h-full flex-col gap-4" role="status" aria-label="Loading events">
                            <span className="sr-only">Loading events…</span>
                            <Skeleton className="h-8 w-40" />
                            <Skeleton className="min-h-0 flex-1 rounded-lg" />
                        </div>
                    ) : (
                        <EventMonthCalendar events={events} onEventClick={onEventClick} />
                    )}
                </div>
            ) : (
                <EventList
                    events={events}
                    loading={loading}
                    range={listRange}
                    onRangeChange={setListRange}
                    onEventClick={onEventClick}
                />
            )}
        </div>
    );
}
