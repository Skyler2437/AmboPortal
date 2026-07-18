import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@ambo/database/admin-client";
import { setSessionCookie } from "@/lib/session";
import { checkRateLimit, getRateLimitKey } from "@/lib/rate-limit";
import bcrypt from "bcryptjs";

function redirectForRole(role: string): string {
  switch (role) {
    case "basic":
      return "/apply";
    case "applicant":
      return "/status";
    case "admin":
    case "superadmin":
      return "/admin";
    default:
      return "/student";
  }
}

export async function POST(req: NextRequest) {
  try {
    const rateKey = getRateLimitKey(req, "login");
    const { allowed, resetIn } = await checkRateLimit(rateKey, { maxRequests: 10, windowSeconds: 900 });
    if (!allowed) {
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(resetIn) } }
      );
    }

    const { email: emailOrPhone, password } = await req.json();

    if (!emailOrPhone || !password) {
      return NextResponse.json(
        { error: "Email and password are required." },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();
    const identifier = emailOrPhone.trim().toLowerCase();

    // Look up user by email or 10-digit phone number
    let query = supabase.from("users").select("id, role, password_hash, email");
    if (/^\d{10}$/.test(identifier)) {
      query = query.eq("phone", identifier);
    } else {
      query = query.eq("email", identifier);
    }

    const { data: user, error: lookupError } = await query.single();

    if (lookupError || !user) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    // Verify password against stored hash
    if (!user.password_hash) {
      return NextResponse.json(
        { error: "No password set for this account. Please register or reset your password." },
        { status: 401 }
      );
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return NextResponse.json(
        { error: "Invalid email or password." },
        { status: 401 }
      );
    }

    // Set session cookie
    await setSessionCookie({
      userId: user.id,
      role: user.role as "basic" | "student" | "admin" | "superadmin" | "applicant",
    });

    // Best-effort so a missing migration or analytics failure never blocks login.
    try {
      await supabase.from("users").update({ last_login_at: new Date().toISOString() }).eq("id", user.id);
    } catch (activityError) {
      console.error("Failed to record login activity:", activityError);
    }

    return NextResponse.json({ redirect: redirectForRole(user.role) });
  } catch (err) {
    console.error("Login error:", err);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
