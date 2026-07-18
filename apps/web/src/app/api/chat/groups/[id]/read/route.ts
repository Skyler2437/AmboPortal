import { createAdminClient } from "@ambo/database/admin-client";
import { getSession } from "@/lib/session";
import { NextResponse } from "next/server";

export async function POST(
    _req: Request,
    { params }: { params: { id: string } },
) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createAdminClient();
    const { data: membership, error: membershipError } = await supabase
        .from("chat_participants")
        .select("group_id")
        .eq("group_id", params.id)
        .eq("user_id", session.userId)
        .maybeSingle();

    if (membershipError) {
        return NextResponse.json({ error: "Failed to verify membership" }, { status: 500 });
    }
    if (!membership) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { error } = await supabase
        .from("chat_participants")
        .update({ last_read_at: new Date().toISOString() })
        .eq("group_id", params.id)
        .eq("user_id", session.userId);

    if (error) {
        return NextResponse.json({ error: "Failed to mark chat as read" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
}
