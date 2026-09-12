import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@ambo/database/admin-client";
import { getSession } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";

export async function communityActor(req: Request, adminOnly = false) {
  const db = createAdminClient();
  let userId: string | undefined;
  const authorization = req.headers.get("authorization");
  if (authorization) {
    if (!authorization.startsWith("Bearer ")) return { response: fail("Please sign in again.", 401) };
    const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await auth.auth.getUser(authorization.slice(7));
    if (!error) userId = data.user?.id;
  } else {
    userId = (await getSession())?.userId;
  }
  if (!userId) return { response: fail("Please sign in again.", 401) };
  const { data: user, error } = await db.from("users").select("role").eq("id", userId).maybeSingle();
  if (error) return { response: fail("Unable to check your account. Please try again.", 503) };
  const roles = adminOnly ? ["admin", "superadmin"] : ["student", "admin", "superadmin"];
  if (!user || !roles.includes(user.role)) return { response: fail("You do not have access to this action.", 403) };
  return { db, actor: { userId, role: user.role as string } };
}

export const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
export async function mutationLimit(userId: string) {
  const limit = await checkRateLimit(`community:${userId}`, { maxRequests: 60, windowSeconds: 300 });
  return limit.allowed ? null : fail("Please wait a few minutes before trying again.", 429);
}
export async function readBody(req: Request): Promise<unknown> {
  // Bound the actual body, including requests without Content-Length.
  const text = await req.text();
  if (new TextEncoder().encode(text).length > 30_000) throw new Error("BODY_TOO_LARGE");
  return JSON.parse(text);
}
export function communityError(error: unknown) {
  if (error instanceof SyntaxError) return fail("Invalid request. Please try again.");
  if (error instanceof Error && error.message === "BODY_TOO_LARGE") return fail("This post is too large.", 413);
  console.error("[community] Request failed", error);
  return fail("Unable to save or load this post. Please try again.", 500);
}
