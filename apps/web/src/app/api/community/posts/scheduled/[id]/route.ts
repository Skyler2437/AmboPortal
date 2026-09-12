import { NextResponse } from "next/server";
import { communityActor, communityError, fail, mutationLimit, readBody } from "@/lib/community/server";
import { communityPostSchema, postIdSchema } from "@/lib/community/validation";
type Context = { params: { id: string } };

export async function PATCH(req: Request, { params }: Context) {
  try {
    const auth = await communityActor(req, true);
    if (auth.response) return auth.response;
    if (!postIdSchema.safeParse(params.id).success) return fail("Invalid post.");
    const limit = await mutationLimit(auth.actor.userId);
    if (limit) return limit;
    const parsed = communityPostSchema.safeParse(await readBody(req));
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    if (!parsed.data.publish_at) return fail("Choose a future publishing time.");
    let query = auth.db.from("scheduled_posts").update(parsed.data).eq("id", params.id);
    if (auth.actor.role !== "superadmin") query = query.eq("user_id", auth.actor.userId);
    const { data, error } = await query.select("id,user_id,content,publish_at,poll,created_at").maybeSingle();
    if (error) throw error;
    if (!data) return fail("This scheduled post is no longer available. It may already have been published.", 404);
    return NextResponse.json({ post: data });
  } catch (error) { return communityError(error); }
}
export async function DELETE(req: Request, { params }: Context) {
  try {
    const auth = await communityActor(req, true);
    if (auth.response) return auth.response;
    if (!postIdSchema.safeParse(params.id).success) return fail("Invalid post.");
    const limit = await mutationLimit(auth.actor.userId);
    if (limit) return limit;
    let query = auth.db.from("scheduled_posts").delete().eq("id", params.id);
    if (auth.actor.role !== "superadmin") query = query.eq("user_id", auth.actor.userId);
    const { data, error } = await query.select("id").maybeSingle();
    if (error) throw error;
    if (!data) return fail("This scheduled post is no longer available. It may already have been published.", 404);
    return NextResponse.json({ ok: true });
  } catch (error) { return communityError(error); }
}
