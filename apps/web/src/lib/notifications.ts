import webpush from "web-push";
import { createAdminClient } from "@ambo/database/admin-client";

// Initialize web-push with VAPID keys
if (
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT
) {
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT,
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

export type PushPayload = {
    title: string;
    body: string;
    url?: string;
    mobilePath?: string;
    badge?: number;
};

export function buildExpoPushMessage(token: string, payload: PushPayload) {
    return {
        to: token,
        sound: "default" as const,
        title: payload.title,
        body: payload.body,
        data: {
            url: payload.url,
            mobilePath: payload.mobilePath,
        },
        ...(payload.badge !== undefined ? { badge: payload.badge } : {}),
    };
}

/**
 * Send push notifications to Expo mobile devices for a list of user IDs.
 * Uses the Expo Push API (https://exp.host/--/api/v2/push/send).
 */
async function sendExpoNotifications(
    userIds: string[],
    payload: PushPayload,
    excludeUserId?: string
) {
    const supabase = createAdminClient();

    const { data: tokens } = await supabase
        .from("expo_push_tokens")
        .select("id, user_id, token")
        .in("user_id", userIds);

    if (!tokens || tokens.length === 0) return;

    const messages = tokens
        .filter((t) => t.user_id !== excludeUserId)
        .filter((t) => t.token.startsWith("ExponentPushToken["))
        .map((t) => buildExpoPushMessage(t.token, payload));

    if (messages.length === 0) return;

    // Expo Push API accepts batches of up to 100
    const chunks: typeof messages[] = [];
    for (let i = 0; i < messages.length; i += 100) {
        chunks.push(messages.slice(i, i + 100));
    }

    for (const chunk of chunks) {
        try {
            const res = await fetch("https://exp.host/--/api/v2/push/send", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                },
                body: JSON.stringify(chunk),
            });

            const result = await res.json();

            // Clean up invalid tokens (DeviceNotRegistered)
            if (result.data) {
                for (let i = 0; i < result.data.length; i++) {
                    if (result.data[i].status === "error" &&
                        result.data[i].details?.error === "DeviceNotRegistered") {
                        const badToken = chunk[i].to;
                        await supabase
                            .from("expo_push_tokens")
                            .delete()
                            .eq("token", badToken);
                    }
                }
            }
        } catch (err) {
            console.error("[ExpoPush] Failed to send:", err);
        }
    }
}

/**
 * Send a push notification to a specific user.
 */
export async function sendNotificationToUser(
    userId: string,
    payload: PushPayload
) {
    const supabase = createAdminClient();

    // 1. Send to Web Push subscriptions
    const { data: subscriptions, error } = await supabase
        .from("push_subscriptions")
        .select("*")
        .eq("user_id", userId);

    if (!error && subscriptions && subscriptions.length > 0) {
        const payloadString = JSON.stringify(payload);

        const promises = subscriptions.map(async (sub) => {
            const pushSubscription = {
                endpoint: sub.endpoint,
                keys: {
                    p256dh: sub.p256dh,
                    auth: sub.auth,
                },
            };

            try {
                await webpush.sendNotification(pushSubscription, payloadString);
            } catch (err: unknown) {
                console.error(`[Push] Failed to send to ${sub.id}:`, err);
                const statusCode = (err as { statusCode?: number })?.statusCode;
                if (statusCode === 410 || statusCode === 404) {
                    console.log(`[Push] Deleting expired subscription ${sub.id}`);
                    await supabase.from("push_subscriptions").delete().eq("id", sub.id);
                }
            }
        });

        await Promise.all(promises);
    }

    // 2. Send to Expo push tokens (mobile)
    await sendExpoNotifications([userId], payload);
}

/**
 * Send a push notification to all users with a specific role.
 */
export async function sendNotificationToRole(
    role: "admin" | "student",
    payload: PushPayload,
    excludeUserId?: string
) {
    const supabase = createAdminClient();

    // Log start
    await supabase.from("debug_logs").insert({
        level: "info",
        message: `sendNotificationToRole called for role: ${role}`,
        data: { role, excludeUserId },
    });

    // 1. Get users with role
    let roles: string[] = [role];
    if (role === "admin") {
        roles = ["admin", "superadmin"];
    }

    const { data: users, error: userError } = await supabase
        .from("users")
        .select("id")
        .in("role", roles);

    if (userError || !users || users.length === 0) {
        await supabase.from("debug_logs").insert({
            level: "error",
            message: "Failed to fetch users for role",
            data: { error: userError, roles },
        });
        return;
    }

    const userIds = users.map((u) => u.id);
    const targetUserIds = excludeUserId
        ? userIds.filter((id) => id !== excludeUserId)
        : userIds;

    // 2. Web push: Fetch subscriptions for these users
    const { data: subscriptions, error: subError } = await supabase
        .from("push_subscriptions")
        .select("*")
        .in("user_id", targetUserIds);

    if (subError) {
        await supabase.from("debug_logs").insert({
            level: "error",
            message: "Failed to fetch subscriptions",
            data: { error: subError },
        });
    }

    // Send to Web Push subscriptions (if any exist)
    if (subscriptions && subscriptions.length > 0) {
        await supabase.from("debug_logs").insert({
            level: "info",
            message: `Attempting to send to ${subscriptions.length} web push subscriptions`,
            data: { role, excludeUserId, payload },
        });

        const payloadString = JSON.stringify(payload);

        const promises = subscriptions
            .filter((sub) => sub.user_id !== excludeUserId)
            .map(async (sub) => {
                const pushSubscription = {
                    endpoint: sub.endpoint,
                    keys: {
                        p256dh: sub.p256dh,
                        auth: sub.auth,
                    },
                };

                try {
                    await webpush.sendNotification(pushSubscription, payloadString);
                    await supabase.from("debug_logs").insert({
                        level: "info",
                        message: "Push sent successfully",
                        data: { endpoint: sub.endpoint, userId: sub.user_id },
                    });
                } catch (err: unknown) {
                    const statusCode = (err as { statusCode?: number })?.statusCode;
                    await supabase.from("debug_logs").insert({
                        level: "error",
                        message: "Push failed",
                        data: { endpoint: sub.endpoint, error: String(err), statusCode },
                    });

                    if (statusCode === 410 || statusCode === 404) {
                        await supabase.from("push_subscriptions").delete().eq("id", sub.id);
                    }
                }
            });

        await Promise.all(promises);
    }

    // 3. Send to Expo push tokens (mobile)
    await sendExpoNotifications(userIds, payload, excludeUserId);
}
