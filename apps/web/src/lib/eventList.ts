import type { EventDetails } from "@ambo/database/types";

export type EventListRange = "upcoming" | "past" | "all";

/** Ongoing events stay upcoming until they end; history shows the newest first. */
export function eventsForList<T extends EventDetails>(
    events: readonly T[],
    range: EventListRange,
    now = new Date()
): T[] {
    const currentTime = now.getTime();
    return events
        .filter((event) => {
            if (range === "all") return true;
            const upcoming = new Date(event.end_time).getTime() > currentTime;
            return range === "upcoming" ? upcoming : !upcoming;
        })
        .sort((a, b) => {
            const difference = new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
            return range === "past" ? -difference : difference;
        });
}
