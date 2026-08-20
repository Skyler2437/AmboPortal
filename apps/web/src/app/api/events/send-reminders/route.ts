import { NextResponse } from "next/server";
import { createAdminClient } from "@ambo/database/admin-client";
import { sendNotificationToUser } from "@/lib/notifications";

/**
 * GET /api/events/send-reminders
 * Cron endpoint: sends reminder notifications 24 hours before events.
 * Called daily by Vercel Cron.
 */
export async function GET(req: Request) {
    // Verify cron secret (Vercel sets this header automatically for cron
    // jobs). Fail closed: this route is on a public middleware path, so a
    // missing CRON_SECRET must not leave it anonymously triggerable.
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createAdminClient();

    // Find events starting in the next 0-48 hours that haven't had reminders sent
    // Runs daily, so wide window ensures no events are missed
    const now = new Date();
    const windowStart = now;
    const windowEnd = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    const { data: events, error: eventsError } = await supabase
        .from("events")
        .select("id, title, start_time")
        .eq("reminder_sent", false)
        .gte("start_time", windowStart.toISOString())
        .lte("start_time", windowEnd.toISOString());

    if (eventsError) {
        console.error("[Cron] Failed to fetch events:", eventsError);
        return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 });
    }

    if (!events || events.length === 0) {
        return NextResponse.json({ ok: true, eventsProcessed: 0, notificationsSent: 0 });
    }

    let totalSent = 0;

    for (const event of events) {
        // Get RSVPs with going or maybe status
        const { data: rsvps } = await supabase
            .from("event_rsvps")
            .select("user_id")
            .eq("event_id", event.id)
            .in("status", ["going", "maybe"]);

        if (!rsvps || rsvps.length === 0) {
            // Mark as sent even with no RSVPs to avoid re-checking
            await supabase.from("events").update({ reminder_sent: true }).eq("id", event.id);
            continue;
        }

        const userIds = rsvps.map((r) => r.user_id);

        // Check notification preferences for each user
        const { data: prefs } = await supabase
            .from("notification_preferences")
            .select("user_id, event_reminders")
            .in("user_id", userIds);

        // Build a set of users who have opted out
        const optedOut = new Set<string>();
        prefs?.forEach((p) => {
            if (p.event_reminders === false) optedOut.add(p.user_id);
        });

        const eventDate = new Date(event.start_time);
        const timeStr = eventDate.toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: "America/Los_Angeles",
        });

        for (const userId of userIds) {
            if (optedOut.has(userId)) continue;

            try {
                await sendNotificationToUser(userId, {
                    title: "Event Reminder",
                    body: `"${event.title}" starts tomorrow at ${timeStr}`,
                    url: `/student/events`,
                    mobilePath: `/(student)/events/${event.id}`,
                });
                totalSent++;
            } catch (err) {
                console.error(`[Cron] Failed to send reminder to ${userId}:`, err);
            }
        }

        // Mark event as reminder sent
        await supabase.from("events").update({ reminder_sent: true }).eq("id", event.id);
    }

    console.log(`[Cron] Sent ${totalSent} reminders for ${events.length} events`);
    return NextResponse.json({
        ok: true,
        eventsProcessed: events.length,
        notificationsSent: totalSent,
    });
}

// Keep authenticated manual POST requests working while Vercel Cron uses GET.
export const POST = GET;
