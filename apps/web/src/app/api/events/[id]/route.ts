import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@ambo/database/admin-client";
import { createClient } from "@supabase/supabase-js";
import { deleteCalendarEvent } from "@/lib/googleCalendar";
import {
    authorizeStoredEvent,
    isValidEventId,
    type EventActor,
} from "@/lib/eventPermissions";
import { checkContentLength, eventUpdateSchema } from "@/lib/validations";

type AdminClient = ReturnType<typeof createAdminClient>;

async function getEventAuthorizationFailure(
    supabase: AdminClient,
    actor: EventActor,
    eventId: string,
): Promise<NextResponse | null> {
    if (!isValidEventId(eventId)) {
        return NextResponse.json({ error: "Invalid event ID" }, { status: 400 });
    }

    const authorization = await authorizeStoredEvent(actor, eventId, supabase);
    if (authorization.status === "database_error") {
        return NextResponse.json({ error: "Request failed" }, { status: 500 });
    }
    if (authorization.status === "not_found") {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    if (authorization.status === "forbidden") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return null;
}

/**
 * Authenticate via cookie session (web) or Bearer token (mobile).
 * Returns { userId, role } or null.
 */
async function getAuthUser(req: NextRequest) {
    const loadCurrentActor = async (userId: string) => {
        const adminClient = createAdminClient();
        const { data, error } = await adminClient
            .from("users")
            .select("role")
            .eq("id", userId)
            .maybeSingle();

        if (error || !data) return null;
        return { userId, role: data.role };
    };

    // Try cookie-based session first
    try {
        const session = await getSession();
        if (session) {
            return loadCurrentActor(session.userId);
        }
    } catch {
        // cookies() may throw when no cookie context exists (mobile requests)
    }

    // Fallback: mobile bearer token
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return null;
    const token = authHeader.slice(7);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!supabaseUrl || !supabaseServiceKey) return null;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;

    return loadCurrentActor(data.user.id);
}

/**
 * PUT /api/events/[id]
 * Update an event in the database and sync to Google Calendar.
 */
export async function PUT(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    if (!isValidEventId(params.id)) {
        return NextResponse.json({ error: "Invalid event ID" }, { status: 400 });
    }

    const authUser = await getAuthUser(req);
    if (!authUser) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createAdminClient();
    const authorizationFailure = await getEventAuthorizationFailure(
        supabase,
        authUser,
        params.id,
    );
    if (authorizationFailure) {
        return authorizationFailure;
    }

    const sizeError = checkContentLength(req);
    if (sizeError) {
        return NextResponse.json({ error: sizeError }, { status: 413 });
    }

    let rawBody: unknown;
    try {
        rawBody = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = eventUpdateSchema.safeParse(rawBody);
    if (!parsed.success) {
        return NextResponse.json(
            { error: parsed.error.issues[0].message },
            { status: 400 },
        );
    }

    const { rsvp_options, ...eventChanges } = parsed.data;

    const { data: storedTimes, error: storedTimesError } = await supabase
        .from("events")
        .select("start_time, end_time")
        .eq("id", params.id)
        .maybeSingle();
    if (storedTimesError) {
        return NextResponse.json({ error: "Request failed" }, { status: 500 });
    }
    if (!storedTimes) {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const effectiveStart = new Date(eventChanges.start_time ?? storedTimes.start_time);
    const effectiveEnd = new Date(eventChanges.end_time ?? storedTimes.end_time);
    if (effectiveEnd <= effectiveStart) {
        return NextResponse.json(
            { error: "End time must be after start time" },
            { status: 400 },
        );
    }

    // Update the database
    let updated: Record<string, unknown> = { id: params.id };
    if (Object.keys(eventChanges).length > 0) {
        const { data, error } = await supabase
            .from("events")
            .update(eventChanges)
            .eq("id", params.id)
            .select()
            .single();

        if (error) {
            return NextResponse.json({ error: "Request failed" }, { status: 400 });
        }
        updated = data;
    }

    // ── Update custom RSVP options if provided ────────────
    // Diff against the existing options instead of delete-and-reinsert:
    // event_rsvps.rsvp_option_id is ON DELETE SET NULL, so rewriting rows
    // with fresh ids would silently wipe every student's option choice on
    // any event edit. Options that keep their label keep their id (and the
    // RSVPs pointing at it); a renamed label counts as remove + add.
    if (rsvp_options !== undefined) {
        const incoming: string[] = [];
        const seen = new Set<string>();
        for (const raw of rsvp_options) {
            const label = raw.trim();
            if (!label || seen.has(label)) continue;
            seen.add(label);
            incoming.push(label);
        }

        const { data: existingOptions } = await supabase
            .from("event_rsvp_options")
            .select("id, label, sort_order")
            .eq("event_id", params.id);

        const existingByLabel = new Map(
            (existingOptions ?? []).map((o) => [o.label as string, o])
        );

        const removedIds = (existingOptions ?? [])
            .filter((o) => !seen.has(o.label as string))
            .map((o) => o.id);
        if (removedIds.length > 0) {
            await supabase
                .from("event_rsvp_options")
                .delete()
                .in("id", removedIds);
        }

        const newRows: { event_id: string; label: string; sort_order: number }[] = [];
        for (let idx = 0; idx < incoming.length; idx++) {
            const label = incoming[idx];
            const existing = existingByLabel.get(label);
            if (!existing) {
                newRows.push({ event_id: params.id, label, sort_order: idx });
            } else if (existing.sort_order !== idx) {
                await supabase
                    .from("event_rsvp_options")
                    .update({ sort_order: idx })
                    .eq("id", existing.id);
            }
        }
        if (newRows.length > 0) {
            await supabase.from("event_rsvp_options").insert(newRows);
        }
    }

    // ── Google Calendar sync for event-field changes. RSVP-only edits do not
    //    affect the calendar entry. syncEventToGoogle creates one if needed. ──
    let gcalSync: { synced: boolean; reason?: string } = {
        synced: false,
        reason: "No calendar fields changed",
    };
    if (Object.keys(eventChanges).length > 0) {
        try {
            const { syncEventToGoogle } = await import("@/lib/googleCalendar");
            gcalSync = await syncEventToGoogle(params.id);
        } catch (err: unknown) {
            gcalSync = { synced: false, reason: `Import/call error: ${err instanceof Error ? err.message : String(err)}` };
            console.error("[Events PUT] GCal sync failed:", err);
        }

        if (!gcalSync.synced) {
            console.warn("[Events PUT] GCal sync did not complete:", gcalSync.reason);
        }
    }

    return NextResponse.json({ event: updated, gcal_sync: gcalSync });
}

/**
 * DELETE /api/events/[id]
 * Delete an event from the database and Google Calendar.
 */
export async function DELETE(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
    if (!isValidEventId(params.id)) {
        return NextResponse.json({ error: "Invalid event ID" }, { status: 400 });
    }

    const authUser = await getAuthUser(req);
    if (!authUser) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createAdminClient();
    const authorizationFailure = await getEventAuthorizationFailure(
        supabase,
        authUser,
        params.id,
    );
    if (authorizationFailure) {
        return authorizationFailure;
    }

    // Fetch event first to get gcal ID
    const { data: event } = await supabase
        .from("events")
        .select("google_calendar_event_id")
        .eq("id", params.id)
        .single();

    // Delete from database
    const { error } = await supabase
        .from("events")
        .delete()
        .eq("id", params.id);

    if (error) {
        return NextResponse.json({ error: "Request failed" }, { status: 400 });
    }

    // ── Google Calendar sync ─────────────────────────────
    if (event?.google_calendar_event_id) {
        await deleteCalendarEvent(event.google_calendar_event_id);
    }

    return NextResponse.json({ ok: true });
}
