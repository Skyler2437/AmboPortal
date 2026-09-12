import { NextResponse } from "next/server";
import { communityActor, communityError, fail, mutationLimit, readBody } from "@/lib/community/server";
import { communityPostSchema } from "@/lib/community/validation";

export async function POST(req: Request) {
  try {
    const auth = await communityActor(req, true);
    if (auth.response) return auth.response;
    const limit = await mutationLimit(auth.actor.userId);
    if (limit) return limit;
    const parsed = communityPostSchema.safeParse(await readBody(req));
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const { content, publish_at, poll } = parsed.data;
    const { data, error } = await auth.db.rpc("create_community_post", {
      p_user_id: auth.actor.userId, p_content: content, p_publish_at: publish_at, p_poll: poll,
    });
    if (error) throw error;
    if (!data?.id) throw new Error("Post save was not confirmed");
    return NextResponse.json(data, { status: 201 });
  } catch (error) { return communityError(error); }
}
