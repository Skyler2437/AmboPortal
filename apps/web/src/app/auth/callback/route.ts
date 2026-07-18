import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@ambo/database/admin-client";
import { setSessionCookie } from "@/lib/session";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") || null;

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.session?.user) {
      const userId = data.session.user.id;

      // Look up the user's role from the public users table.
      // New users: users.id === supabase auth id (matched at registration).
      // Existing users (pre-dual-auth): look up by email as fallback.
      const adminSupabase = createAdminClient();
      const userEmail = data.session.user.email;

      let userProfile = null;
      const { data: byId } = await adminSupabase
        .from("users")
        .select("id, role")
        .eq("id", userId)
        .single();
      userProfile = byId;

      if (!userProfile && userEmail) {
        const { data: byEmail } = await adminSupabase
          .from("users")
          .select("id, role")
          .eq("email", userEmail)
          .single();
        userProfile = byEmail;
      }

      if (userProfile) {
        try {
          await adminSupabase
            .from("users")
            .update({ last_login_at: new Date().toISOString() })
            .eq("id", userProfile.id);
        } catch (activityError) {
          console.error("Failed to record login activity:", activityError);
        }

        await setSessionCookie({
          userId: userProfile.id,
          role: userProfile.role as "student" | "admin" | "superadmin",
        });

        const isStaff = ["admin", "superadmin"].includes(userProfile.role);
        const redirectTo = next || (isStaff ? "/admin" : "/student");
        return NextResponse.redirect(new URL(redirectTo, req.url));
      }
    }
  }

  return NextResponse.redirect(
    new URL("/login?error=invalid_link", req.url)
  );
}
