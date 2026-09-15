import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@ambo/database/admin-client";
import { NextRequest, NextResponse } from "next/server";
import { userCreateSchema, checkContentLength } from "@/lib/validations";
import { parsePagination, buildPaginatedResponse } from "@/lib/pagination";
import { getTeamServiceTotals } from "@/lib/teamServiceTotals";

export async function GET(req: NextRequest) {
  const { authorized, supabase } = await requireAdmin();
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const { page, limit, from, to } = parsePagination(
    url,
    { page: 1, limit: 50 }
  );

  const { data, error, count } = await supabase
    .from("users")
    .select("id, first_name, last_name, phone, email, role", { count: "exact" })
    .order("last_name")
    .order("id")
    .range(from, to);

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  if (url.searchParams.get("includeTotals") === "true") {
    try {
      const users = data || [];
      const totals = await getTeamServiceTotals(supabase, users.filter((user) => user.role === "student").map((user) => user.id));
      const withTotals = users.map((user) => ({
        ...user,
        ...(totals.get(user.id) ?? { total_hours: null, total_credits: null }),
      }));
      return NextResponse.json(buildPaginatedResponse(withTotals, count || 0, { page, limit, from, to }));
    } catch {
      return NextResponse.json({ error: "Unable to load student totals. Please try again." }, { status: 500 });
    }
  }
  return NextResponse.json(buildPaginatedResponse(data || [], count || 0, { page, limit, from, to }));
}

export async function POST(req: Request) {
  const { authorized } = await requireAdmin();
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Payload size check
  const sizeError = checkContentLength(req);
  if (sizeError) {
    return NextResponse.json({ error: sizeError }, { status: 413 });
  }

  const body = await req.json();

  // Normalize phone before validation
  const normalizedBody = {
    ...body,
    phone: body.phone ? String(body.phone).replace(/\D/g, "") : body.phone,
  };

  const parsed = userCreateSchema.safeParse(normalizedBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const { first_name, last_name, phone, email } = parsed.data;
  const role = body.role === "admin" ? "admin" : "student";

  const supabase = createAdminClient();

  // 1. Create Supabase Auth account with phone number as default password
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: email,
    password: phone,
    email_confirm: true,
  });

  if (authError) {
    console.error("Auth user creation failed:", authError);
    return NextResponse.json({ error: "Failed to create user account" }, { status: 400 });
  }

  // 2. Insert into public users table using the auth user's ID
  const { error: profileError } = await supabase.from("users").insert({
    id: authData.user.id,
    first_name,
    last_name,
    phone,
    email,
    role,
  });

  if (profileError) {
    console.error("Profile insert failed:", profileError);
    // Clean up the auth user if profile insert fails
    await supabase.auth.admin.deleteUser(authData.user.id);
    return NextResponse.json({ error: "Request failed" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
