import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createAdminClient } from "@ambo/database/admin-client";
import { syncEventToGoogle } from "@/lib/googleCalendar";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Extra = any; // RequestHandlerExtra — auth info accessed via extra.authInfo

function requireAdmin(extra: Extra, requiredScope: "read" | "write" = "read") {
  const userId = extra.authInfo?.extra?.userId;
  const role = extra.authInfo?.extra?.role;
  const scopes: string[] = extra.authInfo?.scopes ?? [];
  if (!userId || !role) throw new Error("Unauthorized");
  if (role !== "admin" && role !== "superadmin") {
    throw new Error("Admin or superadmin role required");
  }
  if (!scopes.includes(requiredScope)) {
    throw new Error(`${requiredScope} scope required`);
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

async function logMcpAction(
  actorId: string,
  action: string,
  targetType: string,
  targetId?: string,
  metadata: Record<string, unknown> = {}
) {
  const supabase = createAdminClient();
  const { error } = await supabase.from("audit_logs").insert({
    actor_id: actorId,
    action,
    target_type: targetType,
    target_id: targetId ?? null,
    metadata: { ...metadata, source: "mcp" },
  });
  if (error) console.error("[mcp audit]", error.message);
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
    const { userId } = requireAdmin(extra, "write");
    const supabase = createAdminClient();

    const update: Record<string, unknown> = { status: args.status };
    if (args.credits !== undefined) update.credits = args.credits;
    if (args.hours !== undefined) update.hours = args.hours;

    const { error } = await supabase
      .from("submissions")
      .update(update)
      .eq("id", args.id);

    if (error) return textResult({ error: error.message });
    await logMcpAction(userId, `submission.${args.status.toLowerCase()}`, "submission", args.id, update);
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
    const { userId } = requireAdmin(extra, "write");

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
    await logMcpAction(userId, "event.created", "event", data.id, { title: data.title });
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

  server.registerTool("update_post", {
    description: "Edit an existing social post (admin only)",
    inputSchema: schema({
      post_id: z.string().uuid().describe("Post UUID"),
      content: z.string().trim().min(1).max(5000).describe("Replacement post content"),
    }),
  }, async (args: any, extra: any) => {
    const { userId } = requireAdmin(extra, "write");
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("posts")
      .update({ content: args.content.trim() })
      .eq("id", args.post_id)
      .select("id, content, user_id, created_at")
      .single();
    if (error) return textResult({ error: error.message });
    await logMcpAction(userId, "post.updated", "post", args.post_id);
    return textResult({ ok: true, post: data });
  });

  server.registerTool("update_event", {
    description: "Edit an Ambassador event. Only supplied fields are changed (admin only)",
    inputSchema: schema({
      event_id: z.string().uuid().describe("Event UUID"),
      title: z.string().trim().min(1).max(200).optional(),
      description: z.string().max(5000).nullable().optional(),
      start_time: z.string().datetime().optional(),
      end_time: z.string().datetime().optional(),
      type: z.string().max(100).optional(),
      uniform: z.string().max(500).nullable().optional(),
    }),
  }, async (args: any, extra: any) => {
    const { userId } = requireAdmin(extra, "write");
    const supabase = createAdminClient();
    const { event_id, ...updates } = args;
    if (Object.keys(updates).length === 0) return textResult({ error: "At least one field is required" });

    const { data: current, error: findError } = await supabase
      .from("events").select("start_time, end_time").eq("id", event_id).single();
    if (findError) return textResult({ error: findError.message });
    const start = new Date(updates.start_time ?? current.start_time);
    const end = new Date(updates.end_time ?? current.end_time);
    if (end <= start) return textResult({ error: "end_time must be after start_time" });

    const { data, error } = await supabase
      .from("events").update(updates).eq("id", event_id)
      .select("id, title, description, start_time, end_time, type, uniform").single();
    if (error) return textResult({ error: error.message });
    await logMcpAction(userId, "event.updated", "event", event_id, { fields: Object.keys(updates) });
    const calendarSync = await syncEventToGoogle(event_id);
    return textResult({ ok: true, event: data, google_calendar_sync: calendarSync });
  });

  server.registerTool("update_user", {
    description: "Edit a user's profile or role. Only superadmins may grant superadmin (admin only)",
    inputSchema: schema({
      user_id: z.string().uuid().describe("User UUID"),
      first_name: z.string().trim().min(1).max(100).optional(),
      last_name: z.string().trim().min(1).max(100).optional(),
      email: z.string().email().optional(),
      phone: z.string().regex(/^\d{10}$/).nullable().optional(),
      role: z.enum(["basic", "student", "admin", "superadmin", "applicant"]).optional(),
    }),
  }, async (args: any, extra: any) => {
    const { userId, role } = requireAdmin(extra, "write");
    const { user_id, ...updates } = args;
    if (updates.role === "superadmin" && role !== "superadmin") {
      return textResult({ error: "Only superadmins can grant the superadmin role" });
    }
    if (Object.keys(updates).length === 0) return textResult({ error: "At least one field is required" });
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("users").update(updates).eq("id", user_id)
      .select("id, first_name, last_name, email, phone, role").single();
    if (error) return textResult({ error: error.message });
    if (updates.email) {
      const { error: authError } = await supabase.auth.admin.updateUserById(user_id, { email: updates.email });
      if (authError) {
        return textResult({
          error: `Profile updated, but the authentication email could not be synchronized: ${authError.message}`,
          user: data,
        });
      }
    }
    await logMcpAction(userId, "user.updated", "user", user_id, { fields: Object.keys(updates) });
    return textResult({ ok: true, user: data });
  });

  server.registerTool("list_login_activity", {
    description: "See recent AmboPortal login activity (admin only)",
    inputSchema: schema({
      limit: z.number().int().min(1).max(100).optional().describe("Maximum users (default: 50)"),
    }),
  }, async (args: any, extra: any) => {
    requireAdmin(extra);
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("users")
      .select("id, first_name, last_name, email, role, last_login_at")
      .not("last_login_at", "is", null)
      .order("last_login_at", { ascending: false })
      .limit(args.limit ?? 50);
    if (error) return textResult({ error: error.message, migration_required: "20260717_mcp_login_activity.sql" });
    return textResult({ users: data });
  });

  server.registerTool("list_chats", {
    description: "List recent chat groups and their participants (admin only)",
    inputSchema: schema({ limit: z.number().int().min(1).max(100).optional() }),
  }, async (args: any, extra: any) => {
    requireAdmin(extra);
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("chat_groups")
      .select("id, name, created_at, participants:chat_participants(user:users(id, first_name, last_name, role))")
      .order("created_at", { ascending: false })
      .limit(args.limit ?? 50);
    if (error) return textResult({ error: error.message });
    return textResult({ chats: data });
  });

  server.registerTool("create_chat", {
    description: "Create a direct or group chat with students (admin only)",
    inputSchema: schema({
      participant_ids: z.array(z.string().uuid()).min(1).max(100).describe("Student/user UUIDs to include"),
      name: z.string().trim().min(1).max(200).nullable().optional().describe("Optional group name"),
      initial_message: z.string().trim().min(1).max(5000).optional(),
    }),
  }, async (args: any, extra: any) => {
    const { userId } = requireAdmin(extra, "write");
    const supabase = createAdminClient();
    const participantIds = Array.from(new Set<string>([userId, ...args.participant_ids]));
    const { data: users, error: usersError } = await supabase
      .from("users").select("id").in("id", participantIds);
    if (usersError || users?.length !== participantIds.length) {
      return textResult({ error: "One or more participant IDs do not exist" });
    }
    const { data: group, error } = await supabase
      .from("chat_groups").insert({ name: args.name ?? null, created_by: userId })
      .select("id, name, created_at").single();
    if (error) return textResult({ error: error.message });
    const { error: participantError } = await supabase.from("chat_participants").insert(
      participantIds.map((id) => ({ group_id: group.id, user_id: id }))
    );
    if (participantError) {
      await supabase.from("chat_groups").delete().eq("id", group.id);
      return textResult({ error: participantError.message });
    }
    let message = null;
    if (args.initial_message) {
      const result = await supabase.from("chat_messages").insert({
        group_id: group.id, sender_id: userId, content: args.initial_message.trim(),
      }).select("id, content, created_at").single();
      if (result.error) return textResult({ error: result.error.message, group });
      message = result.data;
    }
    await logMcpAction(userId, "chat.created", "chat_group", group.id, { participant_count: participantIds.length });
    return textResult({ ok: true, group, message });
  });

  server.registerTool("send_chat_message", {
    description: "Send a message to a chat group. The connected admin must be a participant (admin only)",
    inputSchema: schema({
      group_id: z.string().uuid(),
      content: z.string().trim().min(1).max(5000),
    }),
  }, async (args: any, extra: any) => {
    const { userId } = requireAdmin(extra, "write");
    const supabase = createAdminClient();
    const { data: membership } = await supabase.from("chat_participants").select("group_id")
      .eq("group_id", args.group_id).eq("user_id", userId).maybeSingle();
    if (!membership) return textResult({ error: "You must be a participant in this chat" });
    const { data, error } = await supabase.from("chat_messages").insert({
      group_id: args.group_id, sender_id: userId, content: args.content.trim(),
    }).select("id, group_id, sender_id, content, created_at").single();
    if (error) return textResult({ error: error.message });
    await logMcpAction(userId, "chat.message_sent", "chat_group", args.group_id, { message_id: data.id });
    return textResult({ ok: true, message: data });
  });

  server.registerTool("list_audit_log", {
    description: "List recent administrative and MCP actions (admin only)",
    inputSchema: schema({ limit: z.number().int().min(1).max(100).optional() }),
  }, async (args: any, extra: any) => {
    requireAdmin(extra);
    const supabase = createAdminClient();
    const { data, error } = await supabase.from("audit_logs")
      .select("id, action, target_type, target_id, metadata, created_at, actor:users!actor_id(first_name, last_name, email)")
      .order("created_at", { ascending: false }).limit(args.limit ?? 50);
    if (error) return textResult({ error: error.message });
    return textResult({ audit_log: data });
  });
}
