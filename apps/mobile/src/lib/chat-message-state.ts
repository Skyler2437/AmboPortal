export type MessageStatus = 'sending' | 'sent' | 'failed';

export interface ChatUser {
  first_name: string;
  last_name: string;
  avatar_url?: string;
}

export interface ChatMessage {
  id: string;
  group_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  status?: MessageStatus;
  like_count?: number;
  liked?: boolean;
  users?: ChatUser;
}

export interface TypingPresenceTransition {
  isTyping: boolean;
  event: boolean | null;
}

/** Generates a UUID v4 that can be reused as the database id across retries. */
export function createClientMessageId(random: () => number = Math.random): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const value = Math.floor(random() * 16);
    const nibble = character === 'x' ? value : (value & 0x3) | 0x8;
    return nibble.toString(16);
  });
}

/** Pending/failed client rows have a reserved id but are not yet proven stored. */
export function isPersistedChatMessage(message: ChatMessage): boolean {
  return message.status !== 'sending' && message.status !== 'failed';
}

/** Returns a Presence event only when the local typing state changes. */
export function nextTypingPresence(isTyping: boolean, hasText: boolean): TypingPresenceTransition {
  if (hasText && !isTyping) return { isTyping: true, event: true };
  if (!hasText && isTyping) return { isTyping: false, event: false };
  return { isTyping, event: null };
}

const EMPTY_USER: ChatUser = { first_name: '', last_name: '' };

/** Canonical order used by rendering and both directions of keyset pagination. */
export function compareChatMessages(first: ChatMessage, second: ChatMessage): number {
  const timeDifference = new Date(first.created_at).getTime() - new Date(second.created_at).getTime();
  if (timeDifference !== 0) return timeDifference;
  if (first.id === second.id) return 0;
  return first.id < second.id ? -1 : 1;
}

export function sortChatMessages(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort(compareChatMessages);
}

/**
 * A failed history request tells us nothing about whether older rows exist.
 * Only a successful page may change the pagination boundary.
 */
export function resolveHasOlderMessages(
  previous: boolean,
  loadedCount: number | null,
  pageSize: number,
): boolean {
  return loadedCount === null ? previous : loadedCount >= pageSize;
}

export interface RealtimeLikeChange {
  messageId: string;
  userId: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
}

export interface RealtimeLikePayload {
  new: Record<string, unknown>;
  old: Record<string, unknown>;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
}

export function realtimeLikeChangeFromPayload(
  payload: RealtimeLikePayload,
): RealtimeLikeChange | null {
  const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
  const messageId = row.message_id;
  const userId = row.user_id;
  if (typeof messageId !== 'string' || typeof userId !== 'string') return null;
  return { messageId, userId, eventType: payload.eventType };
}

export function isRealtimeLikeChangeRelevant(
  messages: ChatMessage[],
  event: RealtimeLikeChange,
): boolean {
  return event.eventType !== 'UPDATE' &&
    messages.some((message) => message.id === event.messageId);
}

/**
 * Applies like-row changes idempotently for the current user. This makes a
 * local optimistic echo a no-op while still accepting changes made by the
 * same account on another device.
 */
export function applyRealtimeLikeChange(
  messages: ChatMessage[],
  event: RealtimeLikeChange,
  currentUserId: string,
): ChatMessage[] {
  const delta = event.eventType === 'INSERT' ? 1 : event.eventType === 'DELETE' ? -1 : 0;
  if (delta === 0) return messages;

  return messages.map((message) => {
    if (message.id !== event.messageId) return message;

    if (event.userId === currentUserId) {
      const nextLiked = event.eventType === 'INSERT';
      if (Boolean(message.liked) === nextLiked) return message;
      return {
        ...message,
        liked: nextLiked,
        like_count: Math.max(0, (message.like_count ?? 0) + delta),
      };
    }

    return {
      ...message,
      like_count: Math.max(0, (message.like_count ?? 0) + delta),
    };
  });
}

/**
 * Replaces an optimistic row with the authoritative insert response. This is
 * intentionally independent of Realtime so a successful send cannot remain
 * stuck in the `sending` state after a missed subscription event.
 */
export function reconcileServerMessage(
  messages: ChatMessage[],
  serverMessage: ChatMessage,
  optimisticId?: string,
): ChatMessage[] {
  const optimisticIndex = optimisticId ? messages.findIndex((message) => message.id === optimisticId) : -1;
  const serverIndex = messages.findIndex((message) => message.id === serverMessage.id);
  const optimistic = optimisticIndex >= 0 ? messages[optimisticIndex] : undefined;
  const existingServer = serverIndex >= 0 ? messages[serverIndex] : undefined;
  const preserveExistingReactions = Boolean(
    optimisticId &&
    existingServer &&
    isPersistedChatMessage(existingServer),
  );
  const reconciled: ChatMessage = {
    ...optimistic,
    ...existingServer,
    ...serverMessage,
    users: serverMessage.users ?? optimistic?.users ?? existingServer?.users ?? EMPTY_USER,
    like_count: preserveExistingReactions
      ? existingServer?.like_count ?? serverMessage.like_count ?? optimistic?.like_count
      : serverMessage.like_count ?? existingServer?.like_count ?? optimistic?.like_count,
    liked: preserveExistingReactions
      ? existingServer?.liked ?? serverMessage.liked ?? optimistic?.liked
      : serverMessage.liked ?? existingServer?.liked ?? optimistic?.liked,
    status: 'sent',
  };

  const next = messages.filter(
    (message) => message.id !== serverMessage.id && (!optimisticId || message.id !== optimisticId),
  );
  return sortChatMessages([...next, reconciled]);
}

/** Adds a Realtime row immediately and deduplicates insert-response races. */
export function mergeRealtimeMessage(
  messages: ChatMessage[],
  serverMessage: ChatMessage,
  fallbackUser: ChatUser = EMPTY_USER,
): ChatMessage[] {
  const hydrated = { ...serverMessage, users: serverMessage.users ?? fallbackUser };
  const existing = messages.find((message) => message.id === serverMessage.id);
  if (existing) {
    return isPersistedChatMessage(existing)
      ? messages
      : reconcileServerMessage(messages, hydrated, existing.id);
  }

  return sortChatMessages([...messages, { ...hydrated, status: 'sent' }]);
}

/** Merges a reconnect snapshot while retaining local failed/pending rows. */
export function mergeServerSnapshot(
  messages: ChatMessage[],
  serverMessages: ChatMessage[],
): ChatMessage[] {
  const merged = serverMessages.reduce(
    (current, serverMessage) => reconcileServerMessage(current, serverMessage),
    messages,
  );

  return sortChatMessages(merged);
}

/**
 * Prevents a likes query that overlapped a local mutation from restoring a
 * stale count/liked value while still accepting all other server fields.
 */
export function mergeServerSnapshotPreservingLikes(
  messages: ChatMessage[],
  serverMessages: ChatMessage[],
  preserveCurrentLikes: boolean,
): ChatMessage[] {
  if (!preserveCurrentLikes) return mergeServerSnapshot(messages, serverMessages);

  const currentById = new Map(messages.map((message) => [message.id, message] as const));
  const protectedSnapshot = serverMessages.map((message) => {
    const current = currentById.get(message.id);
    return current
      ? {
          ...message,
          liked: current.liked,
          like_count: current.like_count,
        }
      : message;
  });
  return mergeServerSnapshot(messages, protectedSnapshot);
}

export interface ChatMessageLikeRow {
  message_id: string;
  user_id: string;
}

export interface DecoratedMessageLikes {
  messages: ChatMessage[];
  authoritative: boolean;
}

/**
 * `null` represents a failed likes query, not a successful empty result.
 * Known reaction state is left untouched until an authoritative read succeeds.
 */
export function decorateMessagesWithLikeRows(
  messages: ChatMessage[],
  currentUserId: string,
  likeRows: ChatMessageLikeRow[] | null,
): DecoratedMessageLikes {
  if (likeRows === null) {
    return { messages, authoritative: false };
  }

  const counts = new Map<string, number>();
  const mine = new Set<string>();
  for (const row of likeRows) {
    counts.set(row.message_id, (counts.get(row.message_id) ?? 0) + 1);
    if (row.user_id === currentUserId) mine.add(row.message_id);
  }

  return {
    messages: messages.map((message) => ({
      ...message,
      like_count: counts.get(message.id) ?? 0,
      liked: mine.has(message.id),
    })),
    authoritative: true,
  };
}

const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000] as const;

export function reconnectDelayMs(attempt: number): number {
  return RECONNECT_DELAYS_MS[Math.min(Math.max(0, attempt), RECONNECT_DELAYS_MS.length - 1)];
}
