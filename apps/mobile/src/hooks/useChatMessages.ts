import { useCallback, useEffect, useRef, useState } from 'react';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { DEMO_MODE, demoMessagesByGroup } from '@/lib/demo';
import {
  applyRealtimeLikeChange,
  createClientMessageId,
  decorateMessagesWithLikeRows,
  isPersistedChatMessage,
  isRealtimeLikeChangeRelevant,
  mergeRealtimeMessage,
  mergeServerSnapshotPreservingLikes,
  nextTypingPresence,
  realtimeLikeChangeFromPayload,
  reconcileServerMessage,
  reconnectDelayMs,
  resolveHasOlderMessages,
  type ChatMessage,
  type DecoratedMessageLikes,
  type ChatUser,
  type MessageStatus,
} from '@/lib/chat-message-state';

export type { ChatMessage, ChatUser, MessageStatus } from '@/lib/chat-message-state';

const PAGE_SIZE = 50;
const TYPING_IDLE_MS = 3000;
const EMPTY_USER: ChatUser = { first_name: '', last_name: '' };

export type ChatConnectionStatus =
  | 'CONNECTING'
  | 'RECONNECTING'
  | REALTIME_SUBSCRIBE_STATES;

export interface TypingUser {
  userId: string;
  firstName: string;
}

interface MessageCursor {
  created_at: string;
  id: string;
}

function newestServerCursor(messages: ChatMessage[], groupId: string): MessageCursor | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.group_id === groupId && isPersistedChatMessage(message)) {
      return { created_at: message.created_at, id: message.id };
    }
  }
  return null;
}

function earlierCursor(
  first: MessageCursor | null,
  second: MessageCursor | null,
): MessageCursor | null {
  if (!first) return second;
  if (!second) return first;
  if (first.created_at !== second.created_at) {
    return new Date(first.created_at).getTime() < new Date(second.created_at).getTime()
      ? first
      : second;
  }
  return first.id < second.id ? first : second;
}

async function decorateMessageLikes(
  rows: ChatMessage[],
  currentUserId: string,
): Promise<DecoratedMessageLikes> {
  const ids = rows.filter(isPersistedChatMessage).map((message) => message.id);
  if (ids.length === 0) {
    return decorateMessagesWithLikeRows(rows, currentUserId, []);
  }

  try {
    const { data: likeRows, error: likesError } = await supabase
      .from('chat_message_likes')
      .select('message_id, user_id')
      .in('message_id', ids);

    return decorateMessagesWithLikeRows(
      rows,
      currentUserId,
      likesError
        ? null
        : (likeRows || []) as Array<{ message_id: string; user_id: string }>,
    );
  } catch {
    return decorateMessagesWithLikeRows(rows, currentUserId, null);
  }
}

interface PersistMessageInput {
  id: string;
  groupId: string;
  senderId: string;
  content: string;
}

/**
 * Inserts with a stable client-generated UUID. If the response is ambiguous,
 * an exact-id read determines whether PostgreSQL committed before the network
 * failed; retrying the same UUID therefore cannot create a duplicate bubble.
 */
async function persistChatMessage({
  id,
  groupId,
  senderId,
  content,
}: PersistMessageInput): Promise<ChatMessage> {
  let insertFailure: unknown = null;
  try {
    const { data, error } = await supabase
      .from('chat_messages')
      .insert({ id, group_id: groupId, sender_id: senderId, content })
      .select('id, group_id, sender_id, content, created_at')
      .single();
    if (data) return data as ChatMessage;
    insertFailure = error ?? new Error('The message was saved without a response.');
  } catch (error) {
    insertFailure = error;
  }

  try {
    const { data: existing } = await supabase
      .from('chat_messages')
      .select('id, group_id, sender_id, content, created_at')
      .eq('id', id)
      .eq('group_id', groupId)
      .eq('sender_id', senderId)
      .maybeSingle();
    if (existing) return existing as ChatMessage;
  } catch {
    // Preserve the original insert failure; this read is only reconciliation.
  }

  if (insertFailure instanceof Error) throw insertFailure;
  const message = (
    insertFailure &&
    typeof insertFailure === 'object' &&
    'message' in insertFailure &&
    typeof insertFailure.message === 'string'
  )
    ? insertFailure.message
    : 'Message failed to send.';
  throw new Error(message);
}

function useChatMessagesReal(groupId: string, currentUserId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<ChatConnectionStatus>('CONNECTING');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const messagesRef = useRef<ChatMessage[]>([]);
  const profileCacheRef = useRef(new Map<string, ChatUser>());
  const currentUserProfileRef = useRef<ChatUser | null>(null);
  const messageChannelInstanceRef = useRef(
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const messageChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const retryInFlightRef = useRef(new Set<string>());
  const likeMutationInFlightRef = useRef(new Set<string>());
  const likeStateRevisionRef = useRef(0);
  const recoveryGapRef = useRef<{
    groupId: string;
    userId: string;
    generation: number;
    cursor: MessageCursor | null;
  } | null>(null);
  const groupIdRef = useRef(groupId);
  const groupIdentityRef = useRef({ id: groupId, userId: currentUserId, generation: 0 });
  if (
    groupIdentityRef.current.id !== groupId ||
    groupIdentityRef.current.userId !== currentUserId
  ) {
    groupIdentityRef.current = {
      id: groupId,
      userId: currentUserId,
      generation: groupIdentityRef.current.generation + 1,
    };
  }
  groupIdRef.current = groupId;

  const isCurrentThreadRequest = useCallback((
    requestedGroupId: string,
    requestedUserId: string,
    generation: number,
  ) => (
    groupIdentityRef.current.id === requestedGroupId &&
    groupIdentityRef.current.userId === requestedUserId &&
    groupIdentityRef.current.generation === generation
  ), []);

  const updateMessages = useCallback((
    updater: (current: ChatMessage[]) => ChatMessage[],
  ) => {
    setMessages((current) => {
      const next = updater(current);
      messagesRef.current = next;
      return next;
    });
  }, []);

  const cacheProfiles = useCallback((rows: ChatMessage[]) => {
    for (const message of rows) {
      if (message.users) profileCacheRef.current.set(message.sender_id, message.users);
    }
    currentUserProfileRef.current = profileCacheRef.current.get(currentUserId) ?? null;
  }, [currentUserId]);

  const fetchMessages = useCallback(async (
    mode: 'replace' | 'merge' = 'replace',
  ): Promise<MessageCursor | null | undefined> => {
    if (!groupId || !currentUserId) return undefined;
    const requestedGroupId = groupId;
    const requestedUserId = currentUserId;
    const requestGeneration = groupIdentityRef.current.generation;
    if (!isCurrentThreadRequest(requestedGroupId, requestedUserId, requestGeneration)) {
      return undefined;
    }
    if (mode === 'replace') setLoading(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase
        .from('chat_messages')
        .select('*, users:sender_id(first_name, last_name, avatar_url)')
        .eq('group_id', requestedGroupId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE_SIZE);

      if (!isCurrentThreadRequest(requestedGroupId, requestedUserId, requestGeneration)) {
        return undefined;
      }
      if (fetchError) {
        setError(fetchError.message);
        if (mode === 'replace') setLoading(false);
        return undefined;
      }

      const rawRows = (data || []) as ChatMessage[];
      const newest = rawRows[0]
        ? { created_at: rawRows[0].created_at, id: rawRows[0].id }
        : null;
      const fetched = rawRows.filter((message) => message.users != null);
      fetched.reverse();
      const likeRevision = likeStateRevisionRef.current;
      const decorated = await decorateMessageLikes(fetched, requestedUserId);
      if (!isCurrentThreadRequest(requestedGroupId, requestedUserId, requestGeneration)) {
        return undefined;
      }
      cacheProfiles(decorated.messages);
      // Always merge the snapshot. A Realtime row may arrive while this request
      // is in flight, and replacing state would make that just-arrived bubble
      // disappear until the next reconciliation.
      updateMessages((current) => mergeServerSnapshotPreservingLikes(
        current.filter((message) => message.group_id === requestedGroupId),
        decorated.messages,
        !decorated.authoritative || likeRevision !== likeStateRevisionRef.current,
      ));
      setHasOlderMessages(rawRows.length >= PAGE_SIZE);
      setError(null);
      if (mode === 'replace') setLoading(false);
      return newest;
    } catch (fetchThrown) {
      if (!isCurrentThreadRequest(requestedGroupId, requestedUserId, requestGeneration)) {
        return undefined;
      }
      setError(fetchThrown instanceof Error ? fetchThrown.message : 'Messages could not be loaded.');
      if (mode === 'replace') setLoading(false);
      return undefined;
    }
  }, [
    cacheProfiles,
    currentUserId,
    groupId,
    isCurrentThreadRequest,
    updateMessages,
  ]);

  /**
   * Recover every row after a disconnect cursor using forward keyset pages.
   * A latest-50 snapshot alone can strand a middle block when more than one
   * page arrives while Realtime is unavailable.
   */
  const recoverMessagesAfter = useCallback(async (
    startCursor: MessageCursor | null,
    requestedGroupId: string,
    requestedUserId: string,
    requestGeneration: number,
  ): Promise<MessageCursor | null | undefined> => {
    if (!startCursor) {
      return fetchMessages('merge');
    }

    let cursor = startCursor;
    try {
      while (isCurrentThreadRequest(requestedGroupId, requestedUserId, requestGeneration)) {
        const { data, error: fetchError } = await supabase
          .from('chat_messages')
          .select('*, users:sender_id(first_name, last_name, avatar_url)')
          .eq('group_id', requestedGroupId)
          .or(
            `created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`,
          )
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(PAGE_SIZE);

        if (!isCurrentThreadRequest(requestedGroupId, requestedUserId, requestGeneration)) {
          return undefined;
        }
        if (fetchError) {
          setError(fetchError.message);
          return undefined;
        }

        const rawRows = (data || []) as ChatMessage[];
        if (rawRows.length === 0) {
          setError(null);
          return cursor;
        }

        const fetched = rawRows.filter((message) => message.users != null);
        const likeRevision = likeStateRevisionRef.current;
        const decorated = await decorateMessageLikes(fetched, requestedUserId);
        if (!isCurrentThreadRequest(requestedGroupId, requestedUserId, requestGeneration)) {
          return undefined;
        }
        cacheProfiles(decorated.messages);
        updateMessages((current) => mergeServerSnapshotPreservingLikes(
          current.filter((message) => message.group_id === requestedGroupId),
          decorated.messages,
          !decorated.authoritative || likeRevision !== likeStateRevisionRef.current,
        ));

        const lastRow = rawRows[rawRows.length - 1];
        cursor = { created_at: lastRow.created_at, id: lastRow.id };
        if (rawRows.length < PAGE_SIZE) {
          setError(null);
          return cursor;
        }
      }
    } catch (recoveryError) {
      if (isCurrentThreadRequest(requestedGroupId, requestedUserId, requestGeneration)) {
        setError(recoveryError instanceof Error
          ? recoveryError.message
          : 'Live messages could not be recovered.');
      }
    }
    return undefined;
  }, [
    cacheProfiles,
    fetchMessages,
    isCurrentThreadRequest,
    updateMessages,
  ]);

  const refetch = useCallback(async () => {
    const pendingGap = recoveryGapRef.current;
    if (
      pendingGap &&
      isCurrentThreadRequest(
        pendingGap.groupId,
        pendingGap.userId,
        pendingGap.generation,
      )
    ) {
      setError(null);
      const recoveredCursor = await recoverMessagesAfter(
        pendingGap.cursor,
        pendingGap.groupId,
        pendingGap.userId,
        pendingGap.generation,
      );
      if (
        recoveredCursor !== undefined &&
        recoveryGapRef.current === pendingGap
      ) {
        recoveryGapRef.current = null;
      }
      return recoveredCursor;
    }

    const hasCachedMessages = messagesRef.current.some((message) => message.group_id === groupId);
    return fetchMessages(hasCachedMessages ? 'merge' : 'replace');
  }, [fetchMessages, groupId, isCurrentThreadRequest, recoverMessagesAfter]);

  const loadOlderMessages = useCallback(async () => {
    const oldestMessage = messagesRef.current.find((message) => (
      message.group_id === groupId && isPersistedChatMessage(message)
    ));
    if (!groupId || loadingOlderRef.current || !hasOlderMessages || !oldestMessage) return;
    const requestedGroupId = groupId;
    const requestedUserId = currentUserId;
    const requestGeneration = groupIdentityRef.current.generation;
    if (!isCurrentThreadRequest(requestedGroupId, requestedUserId, requestGeneration)) return;

    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const { data, error: fetchError } = await supabase
        .from('chat_messages')
        .select('*, users:sender_id(first_name, last_name, avatar_url)')
        .eq('group_id', requestedGroupId)
        .or(
          `created_at.lt.${oldestMessage.created_at},and(created_at.eq.${oldestMessage.created_at},id.lt.${oldestMessage.id})`,
        )
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE_SIZE);

      if (!isCurrentThreadRequest(requestedGroupId, requestedUserId, requestGeneration)) return;
      if (fetchError) {
        setError(fetchError.message);
        return;
      }

      const rawRows = (data || []) as ChatMessage[];
      const fetched = rawRows.filter((message) => message.users != null);
      fetched.reverse();
      const likeRevision = likeStateRevisionRef.current;
      const decorated = await decorateMessageLikes(fetched, requestedUserId);
      if (!isCurrentThreadRequest(requestedGroupId, requestedUserId, requestGeneration)) return;
      cacheProfiles(decorated.messages);
      setHasOlderMessages((previous) => resolveHasOlderMessages(
        previous,
        rawRows.length,
        PAGE_SIZE,
      ));
      updateMessages((current) => mergeServerSnapshotPreservingLikes(
        current,
        decorated.messages,
        !decorated.authoritative || likeRevision !== likeStateRevisionRef.current,
      ));
    } catch (loadError) {
      if (isCurrentThreadRequest(requestedGroupId, requestedUserId, requestGeneration)) {
        setError(loadError instanceof Error ? loadError.message : 'Earlier messages could not be loaded.');
      }
    } finally {
      if (isCurrentThreadRequest(requestedGroupId, requestedUserId, requestGeneration)) {
        loadingOlderRef.current = false;
        setLoadingOlder(false);
      }
    }
  }, [
    cacheProfiles,
    currentUserId,
    groupId,
    hasOlderMessages,
    isCurrentThreadRequest,
    updateMessages,
  ]);

  // Postgres Changes live on their own channel so Presence rate limits cannot
  // take message delivery offline.
  useEffect(() => {
    if (!groupId || !currentUserId) return;

    const requestedGroupId = groupId;
    const requestedUserId = currentUserId;
    const requestGeneration = groupIdentityRef.current.generation;
    let disposed = false;
    let activeChannel: ReturnType<typeof supabase.channel> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let recoveryRetryTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;
    let recoveryFailureAttempt = 0;
    let channelGeneration = 0;
    let hasSubscribedOnce = false;
    let reconnectCursor: MessageCursor | null | undefined;
    let pendingRecoveryCursor: MessageCursor | null | undefined;
    let recoveryRunning = false;

    const requestIsCurrent = () => (
      !disposed &&
      isCurrentThreadRequest(requestedGroupId, requestedUserId, requestGeneration)
    );

    const queueRecovery = (cursor: MessageCursor | null) => {
      const existingGap = recoveryGapRef.current;
      const combinedCursor = existingGap &&
        existingGap.groupId === requestedGroupId &&
        existingGap.userId === requestedUserId &&
        existingGap.generation === requestGeneration
        ? earlierCursor(existingGap.cursor, cursor)
        : cursor;
      recoveryGapRef.current = {
        groupId: requestedGroupId,
        userId: requestedUserId,
        generation: requestGeneration,
        cursor: combinedCursor,
      };
      pendingRecoveryCursor = pendingRecoveryCursor === undefined
        ? combinedCursor
        : earlierCursor(pendingRecoveryCursor, combinedCursor);
      if (recoveryRunning) return;

      recoveryRunning = true;
      void (async () => {
        let recoveryFailed = false;
        while (requestIsCurrent() && pendingRecoveryCursor !== undefined) {
          const nextCursor = pendingRecoveryCursor;
          pendingRecoveryCursor = undefined;
          const recoveredCursor = await recoverMessagesAfter(
            nextCursor,
            requestedGroupId,
            requestedUserId,
            requestGeneration,
          );
          if (recoveredCursor === undefined) {
            recoveryFailed = true;
            if (!recoveryRetryTimer && recoveryFailureAttempt < 4) {
              const delay = reconnectDelayMs(recoveryFailureAttempt);
              recoveryFailureAttempt += 1;
              recoveryRetryTimer = setTimeout(() => {
                recoveryRetryTimer = null;
                const gap = recoveryGapRef.current;
                if (
                  requestIsCurrent() &&
                  gap?.groupId === requestedGroupId &&
                  gap.userId === requestedUserId &&
                  gap.generation === requestGeneration
                ) {
                  queueRecovery(gap.cursor);
                }
              }, delay);
            }
            break;
          }
          recoveryFailureAttempt = 0;
        }

        if (
          !recoveryFailed &&
          pendingRecoveryCursor === undefined &&
          requestIsCurrent()
        ) {
          const gap = recoveryGapRef.current;
          if (
            gap?.groupId === requestedGroupId &&
            gap.userId === requestedUserId &&
            gap.generation === requestGeneration
          ) {
            recoveryGapRef.current = null;
          }
        }
      })().finally(() => {
        recoveryRunning = false;
        if (requestIsCurrent() && pendingRecoveryCursor !== undefined) {
          const gap = recoveryGapRef.current;
          queueRecovery(
            gap?.groupId === requestedGroupId &&
              gap.userId === requestedUserId &&
              gap.generation === requestGeneration
              ? gap.cursor
              : pendingRecoveryCursor,
          );
        }
      });
    };

    const captureReconnectCursor = () => {
      const cursor = newestServerCursor(messagesRef.current, requestedGroupId);
      reconnectCursor = reconnectCursor === undefined
        ? cursor
        : earlierCursor(reconnectCursor, cursor);
    };

    const hydrateSender = async (messageId: string, senderId: string) => {
      if (profileCacheRef.current.has(senderId)) return;
      const { data: profile } = await supabase
        .from('users')
        .select('first_name, last_name, avatar_url')
        .eq('id', senderId)
        .single();
      if (!profile || !requestIsCurrent()) return;

      const user = profile as ChatUser;
      profileCacheRef.current.set(senderId, user);
      if (senderId === requestedUserId) currentUserProfileRef.current = user;
      updateMessages((current) => current.map((message) =>
        message.id === messageId ? { ...message, users: user } : message,
      ));
    };

    const handleMessageInsert = (payload: { new: Record<string, unknown> }) => {
      const incoming = payload.new as unknown as ChatMessage;
      if (!requestIsCurrent() || incoming.group_id !== requestedGroupId) return;
      const cachedUser = profileCacheRef.current.get(incoming.sender_id) ?? EMPTY_USER;
      updateMessages((current) => mergeRealtimeMessage(current, incoming, cachedUser));
      if (!profileCacheRef.current.has(incoming.sender_id)) {
        void hydrateSender(incoming.id, incoming.sender_id);
      }
    };

    const handleLikeChange = (payload: {
      new: Record<string, unknown>;
      old: Record<string, unknown>;
      eventType: 'INSERT' | 'UPDATE' | 'DELETE';
    }) => {
      if (!requestIsCurrent()) return;
      const event = realtimeLikeChangeFromPayload(payload);
      if (!event) return;
      if (!isRealtimeLikeChangeRelevant(messagesRef.current, event)) return;
      likeStateRevisionRef.current += 1;
      updateMessages((current) => applyRealtimeLikeChange(current, event, requestedUserId));
    };

    const connect = () => {
      if (disposed) return;
      setConnectionStatus(reconnectAttempt > 0 ? 'RECONNECTING' : 'CONNECTING');
      const generation = ++channelGeneration;

      const channel = supabase
        .channel(
          `chat-messages:${requestedGroupId}:${messageChannelInstanceRef.current}:${requestGeneration}:${generation}`,
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'chat_messages',
            filter: `group_id=eq.${requestedGroupId}`,
          },
          handleMessageInsert,
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'chat_message_likes' },
          handleLikeChange,
        )
        .on('system', {}, (payload: { status?: string; message?: string }) => {
          if (
            disposed ||
            channelGeneration !== generation ||
            payload.status !== 'error' ||
            !payload.message
          ) return;
          setConnectionError(payload.message);
        });

      activeChannel = channel;
      messageChannelRef.current = channel;
      channel.subscribe((status, subscribeError) => {
        if (
          disposed ||
          channelGeneration !== generation ||
          activeChannel !== channel
        ) return;

        if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
          const isFirstSubscription = !hasSubscribedOnce;
          hasSubscribedOnce = true;
          reconnectAttempt = 0;
          setConnectionStatus(status);
          setConnectionError(null);
          void initialFetchPromise.then((initialCursor) => {
            if (!requestIsCurrent()) return;
            const cursor = isFirstSubscription
              ? reconnectCursor !== undefined
                ? initialCursor
                  ? earlierCursor(reconnectCursor, initialCursor)
                  : reconnectCursor
                : initialCursor ?? null
              : reconnectCursor !== undefined
                ? reconnectCursor
                : newestServerCursor(messagesRef.current, requestedGroupId);
            reconnectCursor = undefined;
            queueRecovery(cursor);
          });
          return;
        }

        if (
          status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
          status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT
        ) {
          captureReconnectCursor();
          // realtime-js automatically rejoins these states. Starting another
          // channel here would stack duplicate listeners on the same topic.
          setConnectionStatus('RECONNECTING');
          setConnectionError(subscribeError?.message ?? 'Reconnecting live updates…');
          return;
        }

        if (status !== REALTIME_SUBSCRIBE_STATES.CLOSED) {
          setConnectionStatus(status);
          return;
        }

        captureReconnectCursor();
        setConnectionStatus('RECONNECTING');
        setConnectionError(subscribeError?.message ?? 'Live updates were interrupted.');
        if (reconnectTimer) return;
        const delay = reconnectDelayMs(reconnectAttempt);
        reconnectAttempt += 1;
        activeChannel = null;
        messageChannelRef.current = null;
        void supabase.removeChannel(channel);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, delay);
      });
    };

    // Reset a reused thread screen before merging this group's first snapshot.
    setMessages([]);
    messagesRef.current = [];
    recoveryGapRef.current = null;
    retryInFlightRef.current.clear();
    likeMutationInFlightRef.current.clear();
    currentUserProfileRef.current = profileCacheRef.current.get(requestedUserId) ?? null;
    loadingOlderRef.current = false;
    setLoadingOlder(false);
    setHasOlderMessages(true);
    const initialFetchPromise = fetchMessages('replace');
    connect();

    return () => {
      disposed = true;
      channelGeneration += 1;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (recoveryRetryTimer) clearTimeout(recoveryRetryTimer);
      if (activeChannel) void supabase.removeChannel(activeChannel);
      if (messageChannelRef.current === activeChannel) messageChannelRef.current = null;
    };
  }, [
    currentUserId,
    fetchMessages,
    groupId,
    isCurrentThreadRequest,
    recoverMessagesAfter,
    updateMessages,
  ]);

  // Presence is intentionally isolated from database changes. If typing is
  // ever rate-limited, only the ephemeral typing indicator is affected.
  useEffect(() => {
    if (!groupId || !currentUserId) return;

    let disposed = false;
    const requestedGroupId = groupId;
    const requestedUserId = currentUserId;
    const requestGeneration = groupIdentityRef.current.generation;
    const requestIsCurrent = () => (
      !disposed &&
      isCurrentThreadRequest(requestedGroupId, requestedUserId, requestGeneration)
    );
    const channel = supabase
      .channel(`chat-presence:${requestedGroupId}`, {
        config: { presence: { key: requestedUserId } },
      })
      .on('presence', { event: 'sync' }, () => {
        if (!requestIsCurrent()) return;
        const state = channel.presenceState();
        const typers = new Map<string, TypingUser>();
        for (const key of Object.keys(state)) {
          for (const presence of state[key]) {
            const entry = presence as unknown as { typing?: boolean; userId?: string; firstName?: string };
            if (entry.typing && entry.userId && entry.firstName) {
              typers.set(entry.userId, { userId: entry.userId, firstName: entry.firstName });
            }
          }
        }
        setTypingUsers([...typers.values()]);
      })
      .subscribe((status) => {
        if (!requestIsCurrent()) return;
        if (
          status === REALTIME_SUBSCRIBE_STATES.CLOSED ||
          status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
          status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT
        ) {
          isTypingRef.current = false;
          setTypingUsers([]);
        }
      });

    presenceChannelRef.current = channel;
    return () => {
      disposed = true;
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
      isTypingRef.current = false;
      setTypingUsers([]);
      void supabase.removeChannel(channel);
      if (presenceChannelRef.current === channel) presenceChannelRef.current = null;
    };
  }, [currentUserId, groupId, isCurrentThreadRequest]);

  useEffect(() => {
    currentUserProfileRef.current = currentUserId
      ? profileCacheRef.current.get(currentUserId) ?? null
      : null;
    if (!currentUserId || profileCacheRef.current.has(currentUserId)) return;
    let disposed = false;
    const requestedUserId = currentUserId;
    const requestGeneration = groupIdentityRef.current.generation;
    void supabase
      .from('users')
      .select('first_name, last_name, avatar_url')
      .eq('id', requestedUserId)
      .single()
      .then(({ data }) => {
        if (
          !data ||
          disposed ||
          !isCurrentThreadRequest(groupId, requestedUserId, requestGeneration)
        ) return;
        const profile = data as ChatUser;
        profileCacheRef.current.set(requestedUserId, profile);
        currentUserProfileRef.current = profile;
      });
    return () => {
      disposed = true;
    };
  }, [currentUserId, groupId, isCurrentThreadRequest]);

  const trackTyping = useCallback((typing: boolean, userId: string, firstName: string): boolean => {
    const channel = presenceChannelRef.current;
    if (!channel || channel.state !== 'joined') return false;
    void channel.track({ userId, firstName, typing }).catch(() => {});
    return true;
  }, []);

  const stopTyping = useCallback((userId: string, firstName: string) => {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = null;

    const transition = nextTypingPresence(isTypingRef.current, false);
    isTypingRef.current = transition.isTyping;
    if (transition.event === false) trackTyping(false, userId, firstName);
  }, [trackTyping]);

  const sendTyping = useCallback((userId: string, firstName: string) => {
    const transition = nextTypingPresence(isTypingRef.current, true);
    if (transition.event === true) {
      const sent = trackTyping(true, userId, firstName);
      isTypingRef.current = sent;
    }

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => stopTyping(userId, firstName), TYPING_IDLE_MS);
  }, [stopTyping, trackTyping]);

  const sendMessage = async (senderId: string, content: string) => {
    const requestedGroupId = groupId;
    const requestedUserId = currentUserId;
    const requestGeneration = groupIdentityRef.current.generation;
    if (
      !requestedGroupId ||
      !requestedUserId ||
      !isCurrentThreadRequest(requestedGroupId, requestedUserId, requestGeneration)
    ) return;
    const optimisticId = createClientMessageId();
    const optimisticMessage: ChatMessage = {
      id: optimisticId,
      group_id: requestedGroupId,
      sender_id: senderId,
      content,
      created_at: new Date().toISOString(),
      status: 'sending',
      users: currentUserProfileRef.current ?? profileCacheRef.current.get(senderId) ?? EMPTY_USER,
      like_count: 0,
      liked: false,
    };
    updateMessages((current) => [...current, optimisticMessage]);
    stopTyping(senderId, currentUserProfileRef.current?.first_name ?? '');

    try {
      const persisted = await persistChatMessage({
        id: optimisticId,
        groupId: requestedGroupId,
        senderId,
        content,
      });
      if (!isCurrentThreadRequest(requestedGroupId, requestedUserId, requestGeneration)) return;
      const serverMessage: ChatMessage = {
        ...persisted,
        users: currentUserProfileRef.current ?? profileCacheRef.current.get(senderId) ?? EMPTY_USER,
        like_count: 0,
        liked: false,
      };
      updateMessages((current) => reconcileServerMessage(current, serverMessage, optimisticId));
    } catch (insertError) {
      if (!isCurrentThreadRequest(requestedGroupId, requestedUserId, requestGeneration)) return;
      const alreadyReconciled = messagesRef.current.some((message) => (
        message.id === optimisticId && isPersistedChatMessage(message)
      ));
      if (alreadyReconciled) return;
      updateMessages((current) => current.map((message) =>
        message.id === optimisticId ? { ...message, status: 'failed' as MessageStatus } : message,
      ));
      throw insertError;
    }
  };

  const retryMessage = async (messageId: string, senderId: string): Promise<boolean> => {
    if (retryInFlightRef.current.has(messageId)) return true;
    const failedMessage = messagesRef.current.find((message) => message.id === messageId);
    const requestedGroupId = groupIdRef.current;
    const requestedUserId = groupIdentityRef.current.userId;
    const requestGeneration = groupIdentityRef.current.generation;
    if (
      !failedMessage ||
      failedMessage.status !== 'failed' ||
      !requestedGroupId ||
      failedMessage.group_id !== requestedGroupId ||
      !requestedUserId ||
      !isCurrentThreadRequest(requestedGroupId, requestedUserId, requestGeneration)
    ) return false;
    retryInFlightRef.current.add(messageId);

    updateMessages((current) => current.map((message) =>
      message.id === messageId ? { ...message, status: 'sending' as MessageStatus } : message,
    ));

    try {
      const persisted = await persistChatMessage({
        id: messageId,
        groupId: requestedGroupId,
        senderId,
        content: failedMessage.content,
      });

      if (!isCurrentThreadRequest(requestedGroupId, requestedUserId, requestGeneration)) return true;
      const serverMessage: ChatMessage = {
        ...persisted,
        users: failedMessage.users ?? currentUserProfileRef.current ?? EMPTY_USER,
        like_count: 0,
        liked: false,
      };
      updateMessages((current) => reconcileServerMessage(current, serverMessage, messageId));
      return true;
    } catch {
      if (isCurrentThreadRequest(requestedGroupId, requestedUserId, requestGeneration)) {
        const alreadyReconciled = messagesRef.current.some((message) => (
          message.id === messageId && isPersistedChatMessage(message)
        ));
        if (alreadyReconciled) return true;
        updateMessages((current) => current.map((message) =>
          message.id === messageId ? { ...message, status: 'failed' as MessageStatus } : message,
        ));
      }
      return false;
    } finally {
      retryInFlightRef.current.delete(messageId);
    }
  };

  const toggleMessageLike = async (messageId: string): Promise<boolean> => {
    if (likeMutationInFlightRef.current.has(messageId)) return true;
    const requestedGroupId = groupId;
    const requestedUserId = currentUserId;
    const requestGeneration = groupIdentityRef.current.generation;
    const target = messagesRef.current.find((message) => (
      message.id === messageId && message.group_id === requestedGroupId
    ));
    if (
      !target ||
      !isPersistedChatMessage(target) ||
      !requestedGroupId ||
      !requestedUserId ||
      !isCurrentThreadRequest(requestedGroupId, requestedUserId, requestGeneration)
    ) return false;

    const nowLiked = !target.liked;
    likeMutationInFlightRef.current.add(messageId);
    likeStateRevisionRef.current += 1;
    updateMessages((current) => current.map((message) => (
      message.id === messageId
        ? {
            ...message,
            liked: nowLiked,
            like_count: Math.max(0, (message.like_count ?? 0) + (nowLiked ? 1 : -1)),
          }
        : message
    )));

    try {
      if (nowLiked) {
        const { error: likeError } = await supabase
          .from('chat_message_likes')
          .insert({ message_id: messageId, user_id: requestedUserId });
        if (likeError && likeError.code !== '23505') throw likeError;
      } else {
        const { error: unlikeError } = await supabase
          .from('chat_message_likes')
          .delete()
          .eq('message_id', messageId)
          .eq('user_id', requestedUserId);
        if (unlikeError) throw unlikeError;
      }
      return true;
    } catch {
      if (isCurrentThreadRequest(requestedGroupId, requestedUserId, requestGeneration)) {
        updateMessages((current) => current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                liked: !nowLiked,
                like_count: Math.max(0, (message.like_count ?? 0) + (nowLiked ? -1 : 1)),
              }
            : message,
        ));
      }
      return false;
    } finally {
      likeMutationInFlightRef.current.delete(messageId);
      likeStateRevisionRef.current += 1;
    }
  };

  const refreshLikes = useCallback(async () => {
    const requestedGroupId = groupId;
    const requestedUserId = currentUserId;
    const requestGeneration = groupIdentityRef.current.generation;
    const current = messagesRef.current.filter((message) => message.group_id === requestedGroupId);
    if (current.length === 0) return;
    const likeRevision = likeStateRevisionRef.current;
    const decorated = await decorateMessageLikes(current, requestedUserId);
    if (!isCurrentThreadRequest(requestedGroupId, requestedUserId, requestGeneration)) return;
    if (!decorated.authoritative) return;
    if (likeRevision !== likeStateRevisionRef.current) return;
    const byId = new Map(decorated.messages.map((message) => [message.id, message] as const));
    updateMessages((previous) => previous.map((message) => {
      const decoratedMessage = byId.get(message.id);
      return decoratedMessage
        ? {
            ...message,
            like_count: decoratedMessage.like_count,
            liked: decoratedMessage.liked,
          }
        : message;
    }));
  }, [currentUserId, groupId, isCurrentThreadRequest, updateMessages]);

  return {
    messages,
    toggleMessageLike,
    refreshLikes,
    loading,
    loadingOlder,
    hasOlderMessages,
    error,
    typingUsers,
    connectionStatus,
    connectionError,
    refetch,
    sendMessage,
    retryMessage,
    loadOlderMessages,
    sendTyping,
    stopTyping,
  };
}

function useChatMessagesDemo(_groupId: string, _currentUserId: string) {
  return {
    messages: (demoMessagesByGroup[_groupId] ?? []) as ChatMessage[],
    toggleMessageLike: async (_messageId: string) => true,
    refreshLikes: async () => {},
    loading: false,
    loadingOlder: false,
    hasOlderMessages: false,
    error: null as string | null,
    typingUsers: [] as TypingUser[],
    connectionStatus: REALTIME_SUBSCRIBE_STATES.SUBSCRIBED as ChatConnectionStatus,
    connectionError: null as string | null,
    refetch: async () => {},
    sendMessage: async (_senderId: string, _content: string) => {},
    retryMessage: async (_messageId: string, _senderId: string) => true,
    loadOlderMessages: async () => {},
    sendTyping: (_userId: string, _firstName: string) => {},
    stopTyping: (_userId: string, _firstName: string) => {},
  };
}

export const useChatMessages = DEMO_MODE ? useChatMessagesDemo : useChatMessagesReal;
