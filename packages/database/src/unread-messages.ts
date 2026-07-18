import type { SupabaseClient } from "@supabase/supabase-js";

export function badgeCountToApply(count: number | null): number | null {
  return count;
}

/**
 * Return the server-authoritative unread chat-message total for one user.
 * A null result means the count could not be obtained and callers must leave
 * any existing device badge unchanged.
 */
export async function getUnreadMessageCount(
  client: SupabaseClient,
  userId: string,
): Promise<number | null> {
  const { data, error } = await client.rpc("get_unread_chat_message_count", {
    target_user_id: userId,
  });

  if (error) return null;

  if (data === null || data === undefined || data === "") return null;

  const count = typeof data === "number" ? data : Number(data);
  if (!Number.isFinite(count)) return null;

  return Math.max(0, Math.trunc(count));
}
