export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { communityActor, communityError, fail, mutationLimit, readBody } from "@/lib/community/server";
import { postIdSchema, voteSchema } from "@/lib/community/validation";
type Context = { params: { id: string } };

async function handle(req: Request, { params }: Context, vote: boolean) {
  try {
    const auth = await communityActor(req);
    if (auth.response) return auth.response;
    if (!postIdSchema.safeParse(params.id).success) return fail("Invalid post.");
    if (vote) {
      const limit = await mutationLimit(auth.actor.userId);
      if (limit) return limit;
      const parsed = voteSchema.safeParse(await readBody(req));
      if (!parsed.success) return fail("Choose a valid poll option.");
      const { error } = await auth.db.rpc("cast_post_poll_vote", {
        p_post_id: params.id, p_user_id: auth.actor.userId, p_option_id: parsed.data.option_id,
      });
      if (error) {
        if (error.code === "P0002" || error.code === "P0001" || error.code === "23503" || error.code === "22023") {
          return fail("Your vote was not saved. The poll may have closed or the option is no longer available.", 409);
        }
        throw error;
      }
    }
    const { data, error } = await auth.db.rpc("get_post_poll", { p_post_id: params.id, p_user_id: auth.actor.userId });
    if (error) throw error;
    return NextResponse.json({ poll: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return communityError(error); }
}
export const GET = (req: Request, context: Context) => handle(req, context, false);
export const POST = (req: Request, context: Context) => handle(req, context, true);
