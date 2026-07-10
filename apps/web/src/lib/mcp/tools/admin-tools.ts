import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createAdminClient } from "@ambo/database/admin-client";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Extra = any; // RequestHandlerExtra — auth info accessed via extra.authInfo

function requireAdmin(extra: Extra) {
  const userId = extra.authInfo?.extra?.userId;
  const role = extra.authInfo?.extra?.role;
  if (!userId || !role) throw new Error("Unauthorized");
  if (role !== "admin" && role !== "superadmin") {
    throw new Error("Admin or superadmin role required");
  }
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

export function registerAdminTools(server: McpServer) {
  // ─── List All Submissions ─────────────────────────────
  server.registerTool("list_all_submissions", {
    description: "List all service hour submissions (admin only). Can filter by status.",
    inputSchema: schema({
      page: z.number().min(1).optional().describe("Page number (default: 1)"),
      limit: z.number().min(1).max(100).optional().describe("Results per page (default: 25)"),
      status: z.enum(["Pending", "Approved", "Denied"]).optional().describe("Filter by submission status"),
    }),
  }, async (args: any, extra: any) => {
    requireAdmin(extra);
    const page = args.page ?? 1;
    const limit = args.limit ?? 25;
    const supabase = createAdminClient();
    const from = (page - 1) * limit;

    let query = supabase
      .from("submissions")
      .select(
        "id, service_date, service_type, credits, hours, feedback, status, created_at, users(first_name, last_name, email)",
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(from, from + limit - 1);

    if (args.status) query = query.eq("status", args.status);

    const { data, error, count } = await query;
    if (error) return textResult({ error: error.message });
    return textResult({ submissions: data, total: count, page, limit });
  });

  // ─── Review Submission ────────────────────────────────
  server.registerTool("review_submission", {
    description: "Approve or deny a service hour submission (admin only)",
    inputSchema: schema({
      id: z.string().describe("The UUID of the submission to review"),
      status: z.enum(["Approved", "Denied"]).describe("New status for the submission"),
      credits: z.number().min(0).optional().describe("Optionally adjust credits"),
      hours: z.number().min(0).max(24).optional().describe("Optionally adjust hours"),
    }),
  }, async (args: any, extra: any) => {
    requireAdmin(extra);
    const supabase = createAdminClient();

    const update: Record<string, unknown> = { status: args.status };
    if (args.credits !== undefined) update.credits = args.credits;
    if (args.hours !== undefined) update.hours = args.hours;

    const { error } = await supabase
      .from("submissions")
      .update(update)
      .eq("id", args.id);

    if (error) return textResult({ error: error.message });
    return textResult({ ok: true, id: args.id, status: args.status });
  });

  // ─── Create Event ─────────────────────────────────────
  server.registerTool("create_event", {
    description: "Create a new Ambassador event (admin only)",
    inputSchema: schema({
      title: z.string().min(1).max(200).describe("Event title"),
      start_time: z.string().describe("Start time (ISO 8601 format)"),
      end_time: z.string().describe("End time (ISO 8601 format)"),
      description: z.string().max(5000).optional().describe("Event description"),
      type: z.string().max(100).optional().describe("Event type (default: Event). e.g., Event, Meeting, Training"),
    }),
  }, async (args: any, extra: any) => {
    const { userId } = requireAdmin(extra);

    const start = new Date(args.start_time);
    const end = new Date(args.end_time);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return textResult({ error: "Invalid date format for start_time or end_time" });
    }
    if (end <= start) {
      return textResult({ error: "end_time must be after start_time" });
    }

    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("events")
      .insert({
        title: args.title.trim(),
        start_time: args.start_time,
        end_time: args.end_time,
        description: args.description || null,
        type: args.type || "Event",
        created_by: userId,
      })
      .select("id, title, start_time, end_time, type")
      .single();

    if (error) return textResult({ error: error.message });
    return textResult({ ok: true, event: data });
  });

  // ─── List Users ───────────────────────────────────────
  server.registerTool("list_users", {
    description: "List all Ambassador users (admin only)",
    inputSchema: schema({
      page: z.number().min(1).optional().describe("Page number (default: 1)"),
      limit: z.number().min(1).max(100).optional().describe("Results per page (default: 50)"),
    }),
  }, async (args: any, extra: any) => {
    requireAdmin(extra);
    const page = args.page ?? 1;
    const limit = args.limit ?? 50;
    const supabase = createAdminClient();
    const from = (page - 1) * limit;

    const { data, error, count } = await supabase
      .from("users")
      .select("id, first_name, last_name, email, phone, role", { count: "exact" })
      .order("last_name", { ascending: true })
      .range(from, from + limit - 1);

    if (error) return textResult({ error: error.message });
    return textResult({ users: data, total: count, page, limit });
  });
}
