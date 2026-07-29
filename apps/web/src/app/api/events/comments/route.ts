import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@ambo/database/admin-client";
import { sanitizeText } from "@/lib/sanitize";

export async function GET(req: NextRequest) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const eventId = req.nextUrl.searchParams.get("event_id");
    if (!eventId) {
        return NextResponse.json({ error: "Missing event_id" }, { status: 400 });
    }

    const supabase = createAdminClient();

    const { data: comments } = await supabase
        .from("event_comments")
        .select("*, users(first_name, last_name, role, avatar_url)")
        .eq("event_id", eventId)
        .order("created_at", { ascending: true });

    const { data: rsvps } = await supabase
        .from("event_rsvps")
        .select("status, user_id, rsvp_option_id, users(first_name, last_name, avatar_url)")
        .eq("event_id", eventId);

    // Explanations are stored separately from the generally visible RSVP
    // roster. Re-check the live database role so a stale admin cookie cannot
    // expose other students' private explanations.
    const { data: currentUser } = await supabase
        .from("users")
        .select("role")
        .eq("id", session.userId)
        .maybeSingle();
    const canViewAllExplanations = currentUser?.role === "admin"
        || currentUser?.role === "superadmin";

    let explanationsQuery = supabase
        .from("event_rsvp_explanations")
        .select("user_id, explanation")
        .eq("event_id", eventId);
    if (!canViewAllExplanations) {
        explanationsQuery = explanationsQuery.eq("user_id", session.userId);
    }
    const { data: explanations } = await explanationsQuery;
    const explanationByUser = new Map(
        (explanations || []).map((row) => [row.user_id, row.explanation]),
    );
    const rsvpsWithVisibleExplanations = (rsvps || []).map((rsvp) => {
        const explanation = explanationByUser.get(rsvp.user_id);
        return explanation ? { ...rsvp, explanation } : rsvp;
    });

    const { data: rsvpOptions } = await supabase
        .from("event_rsvp_options")
        .select("*")
        .eq("event_id", eventId)
        .order("sort_order", { ascending: true });

    const { data: attachments } = await supabase
        .from("event_attachments")
        .select("id, file_url, file_name, file_type, file_size, created_at")
        .eq("event_id", eventId)
        .order("created_at", { ascending: true });

    return NextResponse.json({
        comments: comments || [],
        rsvps: rsvpsWithVisibleExplanations,
        rsvp_options: rsvpOptions || [],
        attachments: attachments || [],
    });
}

export async function POST(req: Request) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { event_id, content } = await req.json();
    if (!event_id || !content?.trim()) {
        return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { data: inserted, error: insertError } = await supabase
        .from("event_comments")
        .insert({
            event_id,
            user_id: session.userId,
            content: sanitizeText(content),
        })
        .select("*, users(first_name, last_name, role, avatar_url)")
        .single();

    if (insertError || !inserted) {
        console.error("event_comments insert failed", insertError);
        return NextResponse.json(
            { error: insertError?.message || "Failed to post comment" },
            { status: 400 }
        );
    }

    // Notifications are now handled by the Supabase Database Webhook
    // dispatcher at /api/webhooks/notifications

    return NextResponse.json({ comment: inserted });
}
