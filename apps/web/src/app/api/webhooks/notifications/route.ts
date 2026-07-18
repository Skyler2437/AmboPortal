import { createAdminClient } from "@ambo/database/admin-client";
import {
    sendNotificationToUser,
    sendNotificationToRole,
} from "@/lib/notifications";
import { handleChatMessage } from "@/lib/chat-notification";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Simple in-memory deduplication to handle webhook retries
const recentlyProcessed = new Map<string, number>();
const DEDUP_TTL_MS = 60_000; // 60 seconds

function isDuplicate(key: string): boolean {
    const now = Date.now();
    // Clean up expired entries
    recentlyProcessed.forEach((ts, k) => {
        if (now - ts > DEDUP_TTL_MS) recentlyProcessed.delete(k);
    });
    if (recentlyProcessed.has(key)) return true;
    recentlyProcessed.set(key, now);
    return false;
}

/**
 * POST /api/webhooks/notifications
 *
 * Unified notification dispatcher triggered by Supabase Database Webhooks.
 * Fires on INSERT events for: chat_messages, posts, comments, event_comments.
 */
export async function POST(req: NextRequest) {
    // 1. Verify webhook secret
    const secret = req.headers.get("x-webhook-secret");
    if (!secret || secret !== process.env.SUPABASE_WEBHOOK_SECRET) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: {
        type: string;
        table: string;
        schema: string;
        record: Record<string, unknown>;
        old_record?: Record<string, unknown>;
    };

    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // Only handle INSERT events
    if (body.type !== "INSERT") {
        return NextResponse.json({ ok: true });
    }

    const { table, record } = body;
    const recordId = record.id as string;

    // Deduplication check
    if (recordId && isDuplicate(`${table}:${recordId}`)) {
        return NextResponse.json({ ok: true, dedup: true });
    }

    try {
        switch (table) {
            case "chat_messages":
                await handleChatMessage(record);
                break;
            case "posts":
                await handleNewPost(record);
                break;
            case "comments":
                await handlePostComment(record);
                break;
            case "event_comments":
                await handleEventComment(record);
                break;
            default:
                // Unknown table — ignore
                break;
        }
    } catch (err) {
        console.error(`[Webhook] Error processing ${table}:`, err);
        // Return 200 anyway to prevent Supabase from retrying
        // (we don't want duplicate notifications on retry)
    }

    return NextResponse.json({ ok: true });
}

/**
 * posts INSERT → notify admins; if poster is admin/superadmin, also notify students
 */
async function handleNewPost(record: Record<string, unknown>) {
    const userId = record.user_id as string;
    const content = (record.content as string) || "";

    const supabase = createAdminClient();

    const { data: user } = await supabase
        .from("users")
        .select("first_name, role")
        .eq("id", userId)
        .single();

    if (!user) return;

    const truncatedBody = content.substring(0, 100);

    // 1. Always notify admins
    await sendNotificationToRole(
        "admin",
        {
            title: `New Post from ${user.first_name}`,
            body: truncatedBody,
            url: "/admin/posts",
            mobilePath: "/(admin)/posts",
        },
        userId
    );

    // 2. If poster is admin/superadmin, also notify students
    if (user.role === "admin" || user.role === "superadmin") {
        await sendNotificationToRole(
            "student",
            {
                title: `New Announcement from ${user.first_name}`,
                body: truncatedBody,
                url: "/student/posts",
                mobilePath: "/(student)/posts",
            },
            userId
        );
    }
}

/**
 * comments INSERT → notify post author + admins
 */
async function handlePostComment(record: Record<string, unknown>) {
    const postId = record.post_id as string;
    const userId = record.user_id as string;
    const content = (record.content as string) || "";

    const supabase = createAdminClient();

    // Get the post details
    const { data: post } = await supabase
        .from("posts")
        .select("user_id, content")
        .eq("id", postId)
        .single();

    // Get commenter name
    const { data: commenter } = await supabase
        .from("users")
        .select("first_name")
        .eq("id", userId)
        .single();

    const commenterName = commenter?.first_name || "Someone";
    const postTitle =
        post?.content?.substring(0, 30) || "Post";

    // 1. Notify post author (if different from commenter)
    if (post && post.user_id !== userId) {
        await sendNotificationToUser(post.user_id, {
            title: `New Comment on your post`,
            body: `${commenterName}: ${content.substring(0, 50)}`,
            url: "/student/posts",
            mobilePath: "/(student)/posts",
        });
    }

    // 2. Notify admins
    await sendNotificationToRole(
        "admin",
        {
            title: `New Comment by ${commenterName}`,
            body: `On "${postTitle}": ${content.substring(0, 50)}`,
            url: "/admin/posts",
            mobilePath: "/(admin)/posts",
        },
        userId
    );
}

/**
 * event_comments INSERT → notify admins
 */
async function handleEventComment(record: Record<string, unknown>) {
    const eventId = record.event_id as string;
    const userId = record.user_id as string;
    const content = (record.content as string) || "";

    const supabase = createAdminClient();

    // Get event title
    const { data: event } = await supabase
        .from("events")
        .select("title")
        .eq("id", eventId)
        .single();

    // Get commenter name
    const { data: user } = await supabase
        .from("users")
        .select("first_name, last_name")
        .eq("id", userId)
        .single();

    const userName = user
        ? `${user.first_name} ${user.last_name || ""}`.trim()
        : "Someone";

    if (event) {
        await sendNotificationToRole(
            "admin",
            {
                title: `New Event Comment: ${event.title}`,
                body: `${userName}: ${content.substring(0, 50)}`,
                url: `/admin/events/${eventId}`,
                mobilePath: "/(admin)",
            },
            userId
        );
    }
}
