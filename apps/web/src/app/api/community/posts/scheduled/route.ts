export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { communityActor, communityError } from "@/lib/community/server";

export async function GET(req: Request) {
  try {
    const auth = await communityActor(req, true);
    if (auth.response) return auth.response;
    let query = auth.db.from("scheduled_posts").select("id,user_id,content,publish_at,poll,created_at").order("publish_at");
    if (auth.actor.role !== "superadmin") query = query.eq("user_id", auth.actor.userId);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ posts: data || [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return communityError(error); }
}
