import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createAdminClient } from "@ambo/database/admin-client";
import { SERVICE_TYPES } from "@ambo/database/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Extra = any; // RequestHandlerExtra — auth info accessed via extra.authInfo

function getAuth(extra: Extra, requiredScope: "read" | "write" = "read") {
  const userId = extra.authInfo?.extra?.userId;
  const role = extra.authInfo?.extra?.role;
  const scopes: string[] = extra.authInfo?.scopes ?? [];
  if (!userId || !role) throw new Error("Unauthorized");
  if (!scopes.includes(requiredScope)) throw new Error(`${requiredScope} scope required`);
  return { userId, role };
}

function textResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

// Workaround: zod v3.25 transitional package types don't structurally match
// the MCP SDK's AnySchema union. The schemas work correctly at runtime.
function schema(shape: Record<string, z.ZodTypeAny>) {
  return shape as Record<string, any>;
}

export function registerStudentTools(server: McpServer) {
  // ─── List Events ──────────────────────────────────────
  server.registerTool("list_events", {
    description: "List upcoming Ambassador events with title, date, and type",
  }, async (extra: any) => {
    getAuth(extra);
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("events")
      .select("id, title, description, start_time, end_time, type, uniform")
      .gte("end_time", new Date().toISOString())
      .order("start_time", { ascending: true })
      .limit(50);

    if (error) return textResult({ error: error.message });
    return textResult({ events: data });
  });

  // ─── RSVP to Event ────────────────────────────────────
  server.registerTool("rsvp_event", {
    description: "RSVP to an Ambassador event (going, maybe, or no)",
    inputSchema: schema({
      event_id: z.string().describe("The UUID of the event"),
      status: z.enum(["going", "maybe", "no"]).describe("Your RSVP status"),
    }),
  }, async (args: any, extra: any) => {
    const { userId } = getAuth(extra, "write");
    const supabase = createAdminClient();

    const { error } = await supabase
      .from("event_rsvps")
      .upsert(
        { event_id: args.event_id, user_id: userId, status: args.status },
        { onConflict: "event_id,user_id" }
      );

    if (error) return textResult({ error: error.message });
    return textResult({ ok: true, event_id: args.event_id, status: args.status });
  });

  // ─── Submit Hours ─────────────────────────────────────
  server.registerTool("submit_hours", {
    description: "Submit service hours for credit. Service types include: " + SERVICE_TYPES.join(", "),
    inputSchema: schema({
      service_date: z.string().describe("Date of service (YYYY-MM-DD format)"),
      service_type: z.enum(SERVICE_TYPES).describe("Type of service performed"),
      credits: z.number().min(0).optional().describe("Number of credits earned (default: 0)"),
      hours: z.number().min(0).max(24).optional().describe("Hours spent on service (default: 0)"),
      feedback: z.string().optional().describe("Optional feedback or notes about the service"),
    }),
  }, async (args: any, extra: any) => {
    const { userId, role } = getAuth(extra, "write");
    if (role !== "student" && role !== "admin" && role !== "superadmin") {
      return textResult({ error: "Only students and admins can submit hours" });
    }

    const date = new Date(args.service_date);
    if (isNaN(date.getTime())) return textResult({ error: "Invalid service_date format" });
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    if (date >= tomorrow) return textResult({ error: "Service date cannot be in the future" });

    const supabase = createAdminClient();
    const { error } = await supabase.from("submissions").insert({
      user_id: userId,
      service_date: args.service_date,
      service_type: args.service_type,
      credits: args.credits ?? 0,
      hours: args.hours ?? 0,
      feedback: args.feedback || null,
      status: "Pending",
    });

    if (error) return textResult({ error: error.message });
    return textResult({ ok: true, message: "Submission created successfully (status: Pending)" });
  });

  // ─── List My Submissions ──────────────────────────────
  server.registerTool("list_my_submissions", {
    description: "List your own service hour submissions with status",
    inputSchema: schema({
      page: z.number().min(1).optional().describe("Page number (default: 1)"),
      limit: z.number().min(1).max(100).optional().describe("Results per page (default: 25)"),
    }),
  }, async (args: any, extra: any) => {
    const { userId } = getAuth(extra);
    const page = args.page ?? 1;
    const limit = args.limit ?? 25;
    const supabase = createAdminClient();
    const from = (page - 1) * limit;

    const { data, error, count } = await supabase
      .from("submissions")
      .select("id, service_date, service_type, credits, hours, feedback, status, created_at", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(from, from + limit - 1);

    if (error) return textResult({ error: error.message });
    return textResult({ submissions: data, total: count, page, limit });
  });

  // ─── List Posts ───────────────────────────────────────
  server.registerTool("list_posts", {
    description: "List recent social posts from the Ambassador community",
    inputSchema: schema({
      page: z.number().min(1).optional().describe("Page number (default: 1)"),
      limit: z.number().min(1).max(50).optional().describe("Results per page (default: 10)"),
    }),
  }, async (args: any, extra: any) => {
    getAuth(extra);
    const page = args.page ?? 1;
    const limit = args.limit ?? 10;
    const supabase = createAdminClient();
    const from = (page - 1) * limit;

    const { data, error } = await supabase
      .from("posts")
      .select("id, content, created_at, users(first_name, last_name, role)")
      .order("created_at", { ascending: false })
      .range(from, from + limit - 1);

    if (error) return textResult({ error: error.message });
    return textResult({ posts: data });
  });

  // ─── Create Post ──────────────────────────────────────
  server.registerTool("create_post", {
    description: "Create a new post in the Ambassador social feed",
    inputSchema: schema({
      content: z.string().min(1).max(5000).describe("Post content (max 5000 characters)"),
    }),
  }, async (args: any, extra: any) => {
    const { userId } = getAuth(extra, "write");
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("posts")
      .insert({ user_id: userId, content: args.content.trim() })
      .select("id, content, created_at")
      .single();

    if (error) return textResult({ error: error.message });
    return textResult({ ok: true, post: data });
  });

  // ─── List Resources ───────────────────────────────────
  server.registerTool("list_resources", {
    description: "List available resources (documents, files) in the resource library",
  }, async (extra: any) => {
    getAuth(extra);
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("resources")
      .select("id, title, description, file_type, file_size, created_at")
      .order("created_at", { ascending: false });

    if (error) return textResult({ error: error.message });
    return textResult({ resources: data });
  });
}
