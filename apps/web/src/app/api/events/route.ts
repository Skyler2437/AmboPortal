import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@ambo/database/admin-client";
import { DEFAULT_EVENT_UNIFORM } from "@ambo/database";
import { createCalendarEvent } from "@/lib/googleCalendar";
import { eventSchema, checkContentLength } from "@/lib/validations";

export async function GET() {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
        .from("events")
        .select("*, users!created_by(role)")
        .order("start_time", { ascending: true });

    if (error) {
        return NextResponse.json({ error: "Request failed" }, { status: 400 });
    }

    const { data: myRsvps } = await supabase
        .from("event_rsvps")
        .select("event_id, status, rsvp_option_id")
        .eq("user_id", session.userId);

    const rsvpMap = new Map<string, { status: string; rsvp_option_id: string | null }>();
    (myRsvps || []).forEach((r) => {
        rsvpMap.set(r.event_id, { status: r.status, rsvp_option_id: r.rsvp_option_id });
    });

    const events = (data || []).map((ev) => {
        const mine = rsvpMap.get(ev.id);
        return {
            ...ev,
            my_rsvp_status: mine?.status ?? null,
            my_rsvp_option_id: mine?.rsvp_option_id ?? null,
        };
    });

    return NextResponse.json({ events });
}

export async function POST(req: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!["student", "admin", "superadmin"].includes(session.role)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Payload size check
    const sizeError = checkContentLength(req);
    if (sizeError) {
        return NextResponse.json({ error: sizeError }, { status: 413 });
    }

    const body = await req.json();
    const parsed = eventSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: parsed.error.issues[0].message },
            { status: 400 }
        );
    }

    const { title, description, start_time, end_time, type, uniform, rsvp_options } = parsed.data;

    // No `location` here — the column was dropped (20260310_drop_events_location.sql)
    // and PostgREST rejects inserts that reference it.
    const eventData = {
        title,
        description: description || null,
        start_time,
        end_time,
        type: type || "Event",
        created_by: session.userId,
        uniform: uniform || DEFAULT_EVENT_UNIFORM,
    };

    const supabase = createAdminClient();
    const { data: newEvent, error } = await supabase
        .from("events")
        .insert(eventData)
        .select()
        .single();

    if (error) {
        console.error("[events] Insert failed:", error);
        return NextResponse.json({ error: "Request failed" }, { status: 400 });
    }

    // ── Insert custom RSVP options if provided ────────────
    if (rsvp_options && rsvp_options.length > 0) {
        const optionRows = rsvp_options
            .filter((label: string) => label.trim())
            .map((label: string, idx: number) => ({
                event_id: newEvent.id,
                label: label.trim(),
                sort_order: idx,
            }));
        if (optionRows.length > 0) {
            await supabase.from("event_rsvp_options").insert(optionRows);
        }
    }

    // ── Google Calendar sync ─────────────────────────────
    const gcalId = await createCalendarEvent({
        ...eventData,
        id: newEvent.id,
    });

    if (gcalId) {
        await supabase
            .from("events")
            .update({ google_calendar_event_id: gcalId })
            .eq("id", newEvent.id);
    }

    return NextResponse.json({ ok: true, event: newEvent });
}
