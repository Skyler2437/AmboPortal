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
    // Try cookie-based session first
    try {
        const session = await getSession();
        if (session) {
            return { userId: session.userId, role: session.role };
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

    const adminClient = createAdminClient();
    const { data: dbUser } = await adminClient
        .from("users")
        .select("role")
        .eq("id", data.user.id)
        .single();

    if (!dbUser) return null;
    return { userId: data.user.id, role: dbUser.role };
}

/**
 * PUT /api/events/[id]
 * Update an event in the database and sync to Google Calendar.
 */
export async function PUT(
    req: NextRequest,
    { params }: { params: { id: string } }
) {
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

    const body = await req.json();
    const { title, description, start_time, end_time, type, uniform } =
        body;

    // Update the database
    const { data: updated, error } = await supabase
        .from("events")
        .update({
            ...(title !== undefined && { title }),
            ...(description !== undefined && { description }),
            ...(start_time !== undefined && { start_time }),
            ...(end_time !== undefined && { end_time }),
            ...(type !== undefined && { type }),
            ...(uniform !== undefined && { uniform }),
        })
        .eq("id", params.id)
        .select()
        .single();

    if (error) {
        return NextResponse.json({ error: "Request failed" }, { status: 400 });
    }

    // ── Update custom RSVP options if provided ────────────
    // Diff against the existing options instead of delete-and-reinsert:
    // event_rsvps.rsvp_option_id is ON DELETE SET NULL, so rewriting rows
    // with fresh ids would silently wipe every student's option choice on
    // any event edit. Options that keep their label keep their id (and the
    // RSVPs pointing at it); a renamed label counts as remove + add.
    if (body.rsvp_options !== undefined && Array.isArray(body.rsvp_options)) {
        const incoming: string[] = [];
        const seen = new Set<string>();
        for (const raw of body.rsvp_options) {
            if (typeof raw !== "string") continue;
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

    // ── Google Calendar sync (always attempt — syncEventToGoogle handles
    //    creating a new GCal event if one doesn't exist yet) ──────────
    let gcalSync: { synced: boolean; reason?: string } = { synced: false, reason: "sync not attempted" };
    try {
        const { syncEventToGoogle } = await import("@/lib/googleCalendar");
        gcalSync = await syncEventToGoogle(updated.id);
    } catch (err: unknown) {
        gcalSync = { synced: false, reason: `Import/call error: ${err instanceof Error ? err.message : String(err)}` };
        console.error("[Events PUT] GCal sync failed:", err);
    }

    if (!gcalSync.synced) {
        console.warn("[Events PUT] GCal sync did not complete:", gcalSync.reason);
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
