import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@ambo/database/admin-client";

/**
 * GET /api/account/export
 *
 * Returns all user data as a JSON download.
 * Required by Google Play Data Safety and GDPR right of access.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId } = session;
  const supabase = createAdminClient();

  // Fetch all user data in parallel
  const [
    { data: profile },
    { data: submissions },
    { data: posts },
    { data: comments },
    { data: eventRsvps },
    { data: eventRsvpExplanations },
    { data: eventComments },
    { data: chatMessages },
    { data: chatGroups },
  ] = await Promise.all([
    supabase
      .from("users")
      .select("id, first_name, last_name, email, phone, role, avatar_url, created_at")
      .eq("id", userId)
      .single(),
    supabase
      .from("submissions")
      .select("id, service_date, service_type, credits, hours, feedback, status, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("posts")
      .select("id, content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("comments")
      .select("id, post_id, content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("event_rsvps")
      .select("event_id, status, created_at")
      .eq("user_id", userId),
    supabase
      .from("event_rsvp_explanations")
      .select("event_id, explanation, updated_at")
      .eq("user_id", userId),
    supabase
      .from("event_comments")
      .select("id, event_id, content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("chat_messages")
      .select("id, group_id, content, created_at")
      .eq("sender_id", userId)
      .order("created_at", { ascending: false }),
    supabase
      .from("chat_participants")
      .select("group_id, joined_at:created_at")
      .eq("user_id", userId),
  ]);

  const exportData = {
    exported_at: new Date().toISOString(),
    profile,
    submissions: submissions || [],
    posts: posts || [],
    comments: comments || [],
    event_rsvps: eventRsvps || [],
    event_rsvp_explanations: eventRsvpExplanations || [],
    event_comments: eventComments || [],
    chat_messages: chatMessages || [],
    chat_groups: chatGroups || [],
  };

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="ambo-data-export-${new Date().toISOString().split("T")[0]}.json"`,
    },
  });
}
