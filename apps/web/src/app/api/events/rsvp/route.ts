import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@ambo/database/admin-client";
import { sanitizeText } from "@/lib/sanitize";

const RSVP_STATUSES = new Set(["going", "maybe", "no"]);
const EXPLANATION_STATUSES = new Set(["maybe", "no"]);

export async function POST(req: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { event_id, status, rsvp_option_id, explanation } = await req.json();
    if (!event_id || typeof status !== "string" || !RSVP_STATUSES.has(status)) {
        return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const cleanExplanation = typeof explanation === "string"
        ? sanitizeText(explanation)
        : "";
    if (
        EXPLANATION_STATUSES.has(status)
        && (cleanExplanation.length < 50 || cleanExplanation.length > 500)
    ) {
        return NextResponse.json(
            { error: "Please explain your response in 50–500 characters." },
            { status: 400 },
        );
    }

    const supabase = createAdminClient();
    const { error } = await supabase.rpc("save_event_rsvp_for_user", {
        target_event_id: event_id,
        target_user_id: session.userId,
        target_status: status,
        target_rsvp_option_id: rsvp_option_id ?? null,
        target_explanation: EXPLANATION_STATUSES.has(status) ? cleanExplanation : null,
    });

    if (error) {
        console.error("[event-rsvp] save failed", error);
        return NextResponse.json({ error: "Request failed" }, { status: 400 });
    }

    // Sync to Google Calendar
    try {
        const { syncEventToGoogle } = await import("@/lib/googleCalendar");
        // Run in background
        syncEventToGoogle(event_id).catch(console.error);
    } catch (e) {
        console.error("Failed to sync RSVP to GCal:", e);
    }

    // Return updated list. rsvp_option_id must be included — the modal keys
    // the selected custom option and per-option attendee lists on it.
    const { data } = await supabase
        .from("event_rsvps")
        .select("status, user_id, rsvp_option_id, users(first_name, last_name)")
        .eq("event_id", event_id);

    return NextResponse.json({ rsvps: data || [] });
}
