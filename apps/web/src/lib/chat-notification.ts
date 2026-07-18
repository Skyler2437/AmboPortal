import { createAdminClient } from "@ambo/database/admin-client";
import { getUnreadMessageCount } from "@ambo/database/unread-messages";
import { sendNotificationToUser } from "@/lib/notifications";

/** Dispatch a new chat message to every participant except its sender. */
export async function handleChatMessage(record: Record<string, unknown>) {
    const groupId = record.group_id as string;
    const senderId = record.sender_id as string;
    const content = (record.content as string) || "";

    const supabase = createAdminClient();

    const { data: participants, error } = await supabase
        .from("chat_participants")
        .select("user_id")
        .eq("group_id", groupId);

    if (error || !participants) return;

    const recipientIds = participants
        .map((p) => p.user_id as string)
        .filter((id) => id !== senderId);

    if (recipientIds.length === 0) return;

    const [{ data: sender }, { data: recipients }] = await Promise.all([
        supabase.from("users").select("first_name").eq("id", senderId).single(),
        supabase.from("users").select("id, role").in("id", recipientIds),
    ]);

    if (!recipients || recipients.length === 0) return;

    const senderName = sender?.first_name || "Someone";
    const truncatedBody =
        content.length > 50 ? `${content.substring(0, 50)}...` : content;

    const promises = recipients.map(async (recipient) => {
        const isAdmin = recipient.role === "admin" || recipient.role === "superadmin";
        const webBase = isAdmin ? "/admin" : "/student";
        const mobileBase = isAdmin ? "/(admin)" : "/(student)";
        const badge = await getUnreadMessageCount(supabase, recipient.id);

        return sendNotificationToUser(recipient.id, {
            title: senderName,
            body: truncatedBody,
            url: `${webBase}/chat?group=${groupId}`,
            mobilePath: `${mobileBase}/chat/${groupId}`,
            ...(badge !== null ? { badge } : {}),
        });
    });

    await Promise.allSettled(promises);
}
