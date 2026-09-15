import { describe, expect, it } from "vitest";
import type { EventDetails } from "@ambo/database/types";
import { eventsForList } from "@/lib/eventList";

const now = new Date("2026-09-14T17:00:00Z");
function event(id: string, start_time: string, end_time: string): EventDetails {
    return { id, title: id, description: "", created_by: "admin", type: "Event", start_time, end_time };
}
const events = [
    event("next-month", "2026-10-09T15:00:00Z", "2026-10-09T18:30:00Z"),
    event("old", "2026-05-15T19:45:00Z", "2026-05-15T20:25:00Z"),
    event("just-ended", "2026-09-14T16:00:00Z", "2026-09-14T17:00:00Z"),
    event("ongoing-overnight", "2026-09-13T23:00:00Z", "2026-09-14T18:00:00Z"),
    event("next-week", "2026-09-21T21:15:00Z", "2026-09-22T00:00:00Z"),
];

describe("Event list ranges", () => {
    it("shows ongoing and upcoming events first without rendering months of history", () => {
        expect(eventsForList(events, "upcoming", now).map((item) => item.id))
            .toEqual(["ongoing-overnight", "next-week", "next-month"]);
    });

    it("moves an event to history when it ends and shows recent history first", () => {
        expect(eventsForList(events, "past", now).map((item) => item.id))
            .toEqual(["just-ended", "old"]);
        expect(eventsForList(events, "past", new Date("2026-09-14T18:00:00Z")).map((item) => item.id))
            .toEqual(["just-ended", "ongoing-overnight", "old"]);
    });

    it("keeps every event available in chronological order without changing calendar data", () => {
        const originalOrder = events.map((item) => item.id);
        expect(eventsForList(events, "all", now).map((item) => item.id))
            .toEqual(["old", "ongoing-overnight", "just-ended", "next-week", "next-month"]);
        expect(events.map((item) => item.id)).toEqual(originalOrder);
    });

    it("handles an empty calendar and retains RSVP details on the original event", () => {
        expect(eventsForList([], "upcoming", now)).toEqual([]);
        const going = { ...events[0], my_rsvp_status: "going", my_rsvp_option_id: "morning" };
        expect(eventsForList([going], "upcoming", now)[0]).toBe(going);
    });
});
