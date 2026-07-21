import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@ambo/database/admin-client";
import { NextRequest, NextResponse } from "next/server";
import { createCalendarEvent } from "@/lib/googleCalendar";
import { authorizeEvent } from "@/lib/eventPermissions";

async function getAuthenticatedUserId(
    req: NextRequest
): Promise<string | null> {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return null;

    const token = authHeader.slice(7);
    const supabaseUrl =
        process.env.NEXT_PUBLIC_SUPABASE_URL ||
        process.env.EXPO_PUBLIC_SUPABASE_URL ||
        "";
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

    if (!supabaseUrl || !supabaseAnonKey) return null;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const {
        data: { user },
        error,
    } = await supabase.auth.getUser();
    if (error || !user) return null;
    return user.id;
}

/**
 * POST /api/mobile/sync-event
 * Syncs a newly created event to the admin Google Calendar
 * and all connected users' personal Google Calendars.
 * Body: { eventId: string }
 */
export async function POST(req: NextRequest) {
    const userId = await getAuthenticatedUserId(req);
    if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Load the role used by creator-aware event authorization.
    const supabase = createAdminClient();
    const { data: user } = await supabase
        .from("users")
        .select("role")
        .eq("id", userId)
        .single();

    if (!user) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { eventId } = await req.json();
    if (!eventId) {
        return NextResponse.json(
            { error: "Missing eventId" },
            { status: 400 }
        );
    }

    const authorization = await authorizeEvent(
        { userId, role: user.role },
        eventId,
        async (id) => {
            const { data } = await supabase
                .from("events")
                .select("id, created_by")
                .eq("id", id)
                .maybeSingle();
            return data ? data.created_by : undefined;
        }
    );
    if (authorization.status === "not_found") {
        return NextResponse.json(
            { error: "Event not found" },
            { status: 404 }
        );
    }
    if (authorization.status === "forbidden") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fetch the complete event after authorization
    const { data: event, error } = await supabase
        .from("events")
        .select("*")
        .eq("id", eventId)
        .single();

    if (error || !event) {
        return NextResponse.json(
            { error: "Event not found" },
            { status: 404 }
        );
    }

    // Sync to admin Google Calendar
    let gcalSynced = false;
    let gcalReason = "";

    if (!event.google_calendar_event_id) {
        const gcalId = await createCalendarEvent({
            title: event.title,
            description: event.description,
            start_time: event.start_time,
            end_time: event.end_time,
            type: event.type,
            uniform: event.uniform,
        });

        if (gcalId) {
            await supabase
                .from("events")
                .update({ google_calendar_event_id: gcalId })
                .eq("id", eventId);
            gcalSynced = true;
        } else {
            gcalReason = "createCalendarEvent returned null — check Google Calendar connection.";
        }
    } else {
        // Event already has a GCal ID — use syncEventToGoogle to update it
        const { syncEventToGoogle } = await import("@/lib/googleCalendar");
        const result = await syncEventToGoogle(eventId);
        gcalSynced = result.synced;
        gcalReason = result.reason || "";
    }

    return NextResponse.json({ ok: true, gcal_synced: gcalSynced, gcal_reason: gcalReason });
}
