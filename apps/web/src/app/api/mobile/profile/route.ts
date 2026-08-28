import { createAdminClient } from "@ambo/database/admin-client";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const PROFILE_FIELDS = new Set(["firstName", "lastName", "phone", "avatarUrl"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOwnAvatarUrl(avatarUrl: string, userId: string, supabaseUrl: string) {
  try {
    const url = new URL(avatarUrl);
    const supabaseOrigin = new URL(supabaseUrl).origin;
    return (
      url.origin === supabaseOrigin &&
      url.pathname === `/storage/v1/object/public/avatars/${userId}.jpg`
    );
  } catch {
    return false;
  }
}

/**
 * POST /api/mobile/profile
 *
 * Updates the authenticated mobile user's editable profile fields. This keeps
 * the service-role client on the server while preventing callers from changing
 * ownership, roles, or any other server-managed user fields.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    "";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Server misconfigured" },
      { status: 500 },
    );
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!isRecord(body)) {
    return NextResponse.json({ error: "Invalid profile update" }, { status: 400 });
  }

  const fields = Object.keys(body);
  if (fields.length === 0) {
    return NextResponse.json({ error: "No profile fields provided" }, { status: 400 });
  }

  if (fields.some((field) => !PROFILE_FIELDS.has(field))) {
    return NextResponse.json({ error: "Unsupported profile field" }, { status: 400 });
  }

  const updates: Record<string, string | null> = {};

  if ("firstName" in body) {
    if (typeof body.firstName !== "string" || !body.firstName.trim()) {
      return NextResponse.json(
        { error: "First name is required" },
        { status: 400 },
      );
    }
    updates.first_name = body.firstName.trim();
  }

  if ("lastName" in body) {
    if (typeof body.lastName !== "string") {
      return NextResponse.json({ error: "Invalid last name" }, { status: 400 });
    }
    updates.last_name = body.lastName.trim();
  }

  if ("phone" in body) {
    if (body.phone !== null && typeof body.phone !== "string") {
      return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
    }

    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    if (phone && !/^\d{10}$/.test(phone)) {
      return NextResponse.json(
        { error: "Phone number must be exactly 10 digits" },
        { status: 400 },
      );
    }
    updates.phone = phone || null;
  }

  if ("avatarUrl" in body) {
    if (
      typeof body.avatarUrl !== "string" ||
      !isOwnAvatarUrl(body.avatarUrl, user.id, supabaseUrl)
    ) {
      return NextResponse.json({ error: "Invalid avatar URL" }, { status: 400 });
    }
    updates.avatar_url = body.avatarUrl;
  }

  const admin = createAdminClient();
  const { data: profile, error: updateError } = await admin
    .from("users")
    .update(updates)
    .eq("id", user.id)
    .select("id, first_name, last_name, phone, avatar_url")
    .maybeSingle();

  if (updateError) {
    console.error("[mobile-profile] Update failed:", updateError);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }

  if (!profile) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ profile });
}
