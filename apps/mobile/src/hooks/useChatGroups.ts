import { useState, useEffect, useCallback, useRef } from 'react';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { handleAuthError } from '@/lib/authError';
import { useChatReadStore } from '@/stores/chatReadStore';
import { createChatGroup } from '@/lib/chat';
import { DEMO_MODE, demoChatGroups } from '@/lib/demo';
import {
  applyIncomingChatMessage,
  beginVersionedIntent,
  createKeyedOperationQueue,
  getChatDeletionWatermark,
  isCurrentChatListRequest,
  mergeFetchedChatGroups,
  removeChatWithSnapshot,
  restoreChatSnapshot,
  rollbackRestoredChatSnapshot,
  settleVersionedIntent,
  type ChatDeletionSnapshot,
  type ChatListRequestIdentity,
  type ChatVisibilityIntent,
  type VersionedIntent,
} from '@/lib/chat-list-state';

export interface ChatGroup {
  id: string;
  name: string | null;
  created_by: string;
  created_at: string;
  updated_at?: string;
}

export interface ChatGroupWithMeta extends ChatGroup {
  participants: { user_id: string; users: { first_name: string; last_name: string; avatar_url?: string } }[];
  lastMessage?: { id?: string; content: string; created_at: string; sender_id?: string };
  hasUnread?: boolean;
  starred?: boolean;
}

export type DeleteChatResult =
  | { status: 'deleted'; snapshot: ChatDeletionSnapshot<ChatGroupWithMeta> }
  | { status: 'failed' }
  | { status: 'superseded' };

// Starred chats float to the top; within each tier, most-recent activity wins.
function compareGroups(a: ChatGroupWithMeta, b: ChatGroupWithMeta): number {
  if (!!a.starred !== !!b.starred) return a.starred ? -1 : 1;
  const aTime = a.lastMessage?.created_at || a.updated_at || a.created_at;
  const bTime = b.lastMessage?.created_at || b.updated_at || b.created_at;
  return new Date(bTime).getTime() - new Date(aTime).getTime();
}

function useChatGroupsReal(userId: string) {
  const [groups, setGroups] = useState<ChatGroupWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hasLoadedOnce = useRef(false);
  // Track group IDs for scoped realtime subscription
  const groupIdsRef = useRef<string[]>([]);
  const groupsRef = useRef<ChatGroupWithMeta[]>(groups);
  const starMutationQueueRef = useRef(createKeyedOperationQueue());
  const visibilityMutationQueueRef = useRef(createKeyedOperationQueue());
  const starMutationStateRef = useRef(new Map<string, VersionedIntent<boolean>>());
  const visibilityMutationStateRef = useRef(
    new Map<string, VersionedIntent<ChatVisibilityIntent>>(),
  );
  const localRevisionRef = useRef(new Map<string, number>());
  const requestIdentityRef = useRef<ChatListRequestIdentity>({
    userId,
    generation: 0,
    requestId: 0,
  });
  if (requestIdentityRef.current.userId !== userId) {
    requestIdentityRef.current = {
      userId,
      generation: requestIdentityRef.current.generation + 1,
      requestId: 0,
    };
  }
  groupsRef.current = groups;

  const replaceGroups = useCallback((next: ChatGroupWithMeta[]) => {
    groupsRef.current = next;
    setGroups(next);
  }, []);

  const updateGroups = useCallback((update: (current: ChatGroupWithMeta[]) => ChatGroupWithMeta[]) => {
    setGroups((current) => {
      const next = update(current);
      groupsRef.current = next;
      return next;
    });
  }, []);

  const markGroupChanged = useCallback((groupId: string) => {
    localRevisionRef.current.set(groupId, (localRevisionRef.current.get(groupId) ?? 0) + 1);
  }, []);

  const isCurrentUserGeneration = useCallback((
    requestedUserId: string,
    generation: number,
  ) => (
    requestIdentityRef.current.userId === requestedUserId &&
    requestIdentityRef.current.generation === generation
  ), []);

  useEffect(() => {
    hasLoadedOnce.current = false;
    groupIdsRef.current = [];
    starMutationQueueRef.current = createKeyedOperationQueue();
    visibilityMutationQueueRef.current = createKeyedOperationQueue();
    starMutationStateRef.current.clear();
    visibilityMutationStateRef.current.clear();
    localRevisionRef.current.clear();
    replaceGroups([]);
    setError(null);
    setLoading(Boolean(userId));
  }, [replaceGroups, userId]);

  const fetchGroups = useCallback(async () => {
    if (!userId) return;
    const requestedUserId = userId;
    const requestedIdentity: ChatListRequestIdentity = {
      ...requestIdentityRef.current,
      requestId: requestIdentityRef.current.requestId + 1,
    };
    requestIdentityRef.current = requestedIdentity;
    const revisionSnapshot = new Map(localRevisionRef.current);
    const requestIsCurrent = () => isCurrentChatListRequest(
      requestIdentityRef.current,
      requestedIdentity,
    );

    const commitFetchedGroups = (fetched: ChatGroupWithMeta[]) => {
      if (!requestIsCurrent()) return;
      const changedIds = new Set<string>();
      for (const [groupId, revision] of localRevisionRef.current) {
        if (revision > (revisionSnapshot.get(groupId) ?? 0)) changedIds.add(groupId);
      }
      const starIntents = new Map(
        Array.from(starMutationStateRef.current, ([groupId, state]) => [groupId, state.intent]),
      );
      const visibilityIntents = new Map(
        Array.from(
          visibilityMutationStateRef.current,
          ([groupId, state]) => [groupId, state.intent],
        ),
      );
      updateGroups((current) => {
        const reconciled = mergeFetchedChatGroups(current, fetched, {
          changedIds,
          starIntents,
          visibilityIntents,
        }) as ChatGroupWithMeta[];
        reconciled.sort(compareGroups);
        return reconciled;
      });
      hasLoadedOnce.current = true;
      setError(null);
      setLoading(false);
    };

    // Only show full loading state on initial load, not on refetches
    if (!hasLoadedOnce.current) {
      setLoading(true);
    }
    setError(null);

    try {
      // Try to fetch with last_read_at, fall back to without it if the column doesn't exist yet
      let participantData: any[] | null = null;
      let hasLastReadAt = true;

      const { data: pData, error: pErr } = await supabase
        .from('chat_participants')
        .select('group_id, last_read_at')
        .eq('user_id', requestedUserId);
      if (!requestIsCurrent()) return;

      if (pErr) {
        // Auth-shaped error: sign out so the user lands on login instead of the
        // inline "Try Again" state that can't recover from a stale JWT.
        if (handleAuthError(pErr)) {
          setLoading(false);
          return;
        }
        // Column might not exist yet (migration not applied) - fall back to basic query
        const { data: fallbackData, error: fallbackErr } = await supabase
          .from('chat_participants')
          .select('group_id')
          .eq('user_id', requestedUserId);
        if (!requestIsCurrent()) return;

        if (fallbackErr) {
          if (handleAuthError(fallbackErr)) {
            setLoading(false);
            return;
          }
          setError(fallbackErr.message);
          setLoading(false);
          return;
        }
        participantData = fallbackData;
        hasLastReadAt = false;
      } else {
        participantData = pData;
      }

      const groupIds = (participantData || []).map((p: any) => p.group_id);
      groupIdsRef.current = groupIds;

      if (groupIds.length === 0) {
        commitFetchedGroups([]);
        return;
      }

      // Build a map of group_id -> last_read_at for unread detection (O(1) lookup)
      const lastReadMap = new Map<string, string | null>();
      if (hasLastReadAt) {
        for (const p of participantData || []) {
          lastReadMap.set(p.group_id, p.last_read_at ?? null);
        }
      }

      // Fetch group details with participants
      const { data: groupData, error: gErr } = await supabase
        .from('chat_groups')
        .select('*, latest_messages:chat_messages(id, content, created_at, sender_id)')
        .in('id', groupIds)
        .order('updated_at', { ascending: false })
        .order('created_at', { referencedTable: 'latest_messages', ascending: false })
        .order('id', { referencedTable: 'latest_messages', ascending: false })
        .limit(1, { referencedTable: 'latest_messages' });
      if (!requestIsCurrent()) return;

      if (gErr) {
        if (handleAuthError(gErr)) {
          setLoading(false);
          return;
        }
        setError(gErr.message);
        setLoading(false);
        return;
      }

      // Fetch participants for these groups
      const { data: allParticipants } = await supabase
        .from('chat_participants')
        .select('group_id, user_id, users(first_name, last_name, avatar_url)')
        .in('group_id', groupIds);
      if (!requestIsCurrent()) return;

      // Fetch this user's starred group ids. Degrades gracefully if the
      // chat_stars table/policy isn't applied yet (data is null → no stars).
      const { data: starData, error: starErr } = await supabase
        .from('chat_stars')
        .select('group_id')
        .eq('user_id', requestedUserId);
      if (!requestIsCurrent()) return;
      if (starErr) {
        console.warn('[useChatGroups] chat_stars fetch failed (is the 20260613 migration applied?)', starErr.message);
      }
      const starredSet = new Set<string>((starData || []).map((s: any) => s.group_id));

      // Per-user soft delete. Fetched separately so a missing deleted_at column
      // degrades independently from unread detection.
      const { data: delData, error: delErr } = await supabase
        .from('chat_participants')
        .select('group_id, deleted_at')
        .eq('user_id', requestedUserId);
      if (!requestIsCurrent()) return;
      if (delErr) {
        console.warn('[useChatGroups] deleted_at fetch failed (is the soft-delete migration applied?)', delErr.message);
      }
      const deletedAtMap = new Map<string, string | null>();
      for (const d of (delData || []) as any[]) deletedAtMap.set(d.group_id, d.deleted_at ?? null);

      const result: ChatGroupWithMeta[] = (groupData || []).map((group) => {
        const participants = (allParticipants || [])
          .filter((p) => p.group_id === group.id && p.users != null)
          .map((p) => ({ user_id: p.user_id, users: p.users as unknown as { first_name: string; last_name: string; avatar_url?: string } }));

        const latestMessages = (group.latest_messages || []) as Array<{
          id: string;
          content: string;
          created_at: string;
          sender_id: string;
        }>;
        const lastMessage = latestMessages[0];

        // Per-user soft delete: a chat the user deleted stays hidden until a newer
        // message arrives (so deleting never silently buries new activity).
        const deletedAt = deletedAtMap.get(group.id);
        const hidden =
          !!deletedAt && (!lastMessage || new Date(lastMessage.created_at) <= new Date(deletedAt));
        if (hidden) return null;

        // Determine unread status (only if last_read_at column exists).
        let hasUnread = false;
        if (hasLastReadAt && lastMessage && lastMessage.sender_id !== requestedUserId) {
          const lastReadAt = lastReadMap.get(group.id);
          hasUnread = !lastReadAt || new Date(lastMessage.created_at) > new Date(lastReadAt);
        }

        // Apply optimistic override: if user has opened this group, mark as read.
        const optimisticReadGroups = useChatReadStore.getState().readGroups;
        if (optimisticReadGroups.has(group.id)) hasUnread = false;

        const { latest_messages: _latestMessages, ...groupFields } = group;
        return {
          ...groupFields,
          participants,
          lastMessage: lastMessage || undefined,
          hasUnread,
          starred: starredSet.has(group.id),
        };
      }).filter((g): g is ChatGroupWithMeta => g !== null);

      result.sort(compareGroups);
      commitFetchedGroups(result);
    } catch (fetchError) {
      if (!requestIsCurrent()) return;
      setError(fetchError instanceof Error ? fetchError.message : 'Chats could not be loaded.');
      setLoading(false);
    }
  }, [updateGroups, userId]);

  // Initial fetch + realtime subscription for live chat list updates
  useEffect(() => {
    if (!userId) return;
    const requestedUserId = userId;
    const requestGeneration = requestIdentityRef.current.generation;
    let hasSubscribedOnce = false;
    const requestIsCurrent = () => isCurrentUserGeneration(
      requestedUserId,
      requestGeneration,
    );

    void fetchGroups();

    // Subscribe to new messages in any of the user's groups
    // This updates the chat list preview and unread status in real time
    const channel = supabase
      .channel(`chat-list:${requestedUserId}:${requestGeneration}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
        },
        (payload) => {
          if (!requestIsCurrent()) return;
          const newMsg = payload.new as any;
          // Only process messages for groups we participate in
          if (!groupIdsRef.current.includes(newMsg.group_id)) return;

          const existing = groupsRef.current.find((group) => group.id === newMsg.group_id);
          if (!existing) {
            // Membership or a soft-delete revival changed while the list was
            // open; reconcile the full guarded snapshot.
            void fetchGroups();
            return;
          }

          const nextExisting = applyIncomingChatMessage(existing, newMsg, requestedUserId);
          if (nextExisting === existing) return;
          markGroupChanged(newMsg.group_id);
          if (newMsg.sender_id !== requestedUserId) {
            // Even a delayed/older insert is unread activity. It must clear the
            // optimistic read override without replacing a newer preview.
            useChatReadStore.getState().removeReadGroup(newMsg.group_id);
          }

          // Surgically update the affected group instead of full refetch.
          updateGroups((prev) => {
            const idx = prev.findIndex((g) => g.id === newMsg.group_id);
            if (idx === -1) {
              void fetchGroups();
              return prev;
            }

            const updated = [...prev];
            const nextGroup = applyIncomingChatMessage(updated[idx], newMsg, requestedUserId);
            if (nextGroup === updated[idx]) return prev;
            updated[idx] = nextGroup;

            // Re-sort: starred first, then most recent message bubbles to top
            updated.sort(compareGroups);

            return updated;
          });
        }
      )
      .subscribe((status) => {
        if (!requestIsCurrent() || status !== REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) return;
        if (hasSubscribedOnce) void fetchGroups();
        hasSubscribedOnce = true;
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, fetchGroups, isCurrentUserGeneration, markGroupChanged, updateGroups]);

  const createGroup = async (name: string | null, participantIds: string[]) => {
    const groupId = await createChatGroup(userId, name, participantIds);
    await fetchGroups();
    return groupId;
  };

  // Star/unstar a chat. Optimistically re-sorts, then persists; reverts on
  // failure (e.g. the chat_stars migration hasn't been applied yet).
  const toggleStar = useCallback(
    async (groupId: string, starred: boolean): Promise<boolean> => {
      const requestedUserId = userId;
      const requestGeneration = requestIdentityRef.current.generation;
      if (!requestedUserId || !isCurrentUserGeneration(requestedUserId, requestGeneration)) {
        return false;
      }
      const currentGroup = groupsRef.current.find((group) => group.id === groupId);
      if (!currentGroup) return false;
      const intentState = beginVersionedIntent(
        starMutationStateRef.current.get(groupId),
        !!currentGroup.starred,
        starred,
      );
      starMutationStateRef.current.set(groupId, intentState);
      markGroupChanged(groupId);

      updateGroups((prev) => {
        const updated = prev.map((g) => (g.id === groupId ? { ...g, starred } : g));
        updated.sort(compareGroups);
        return updated;
      });

      return starMutationQueueRef.current.enqueue(`${requestedUserId}:${groupId}`, async () => {
        let mutationError: unknown = null;
        try {
          if (starred) {
            const { error: insErr } = await supabase
              .from('chat_stars')
              .insert({ user_id: requestedUserId, group_id: groupId });
            // 23505 = already starred; treat as success
            if (insErr && insErr.code !== '23505') throw insErr;
          } else {
            const { error: delErr } = await supabase
              .from('chat_stars')
              .delete()
              .eq('user_id', requestedUserId)
              .eq('group_id', groupId);
            if (delErr) throw delErr;
          }
        } catch (e) {
          mutationError = e;
        }

        if (!isCurrentUserGeneration(requestedUserId, requestGeneration)) return true;
        const currentIntent = starMutationStateRef.current.get(groupId);
        if (!currentIntent) return true;
        const resolution = settleVersionedIntent(
          currentIntent,
          intentState.version,
          starred,
          mutationError === null,
        );
        if (resolution.next) starMutationStateRef.current.set(groupId, resolution.next);
        else starMutationStateRef.current.delete(groupId);

        if (mutationError === null || !resolution.isLatest) return true;
        const confirmedStarred = resolution.rollbackTo ?? currentIntent.confirmed;
        markGroupChanged(groupId);
        updateGroups((prev) => {
          const reverted = prev.map((g) => (
            g.id === groupId ? { ...g, starred: confirmedStarred } : g
          ));
          reverted.sort(compareGroups);
          return reverted;
        });
        console.warn('[useChatGroups] toggleStar failed', mutationError);
        return false;
      });
    },
    [isCurrentUserGeneration, markGroupChanged, updateGroups, userId],
  );

  // Per-user soft delete: hide the chat from this user's list by stamping their
  // own chat_participants row. Optimistically removes it; reverts on failure.
  const deleteChat = useCallback(
    async (groupId: string): Promise<DeleteChatResult> => {
      const requestedUserId = userId;
      const requestGeneration = requestIdentityRef.current.generation;
      if (!requestedUserId || !isCurrentUserGeneration(requestedUserId, requestGeneration)) {
        return { status: 'superseded' };
      }
      const removed = removeChatWithSnapshot(groupsRef.current, groupId);
      if (!removed.snapshot) return { status: 'superseded' };
      const intentState = beginVersionedIntent<ChatVisibilityIntent>(
        visibilityMutationStateRef.current.get(groupId),
        'visible',
        'deleted',
      );
      visibilityMutationStateRef.current.set(groupId, intentState);
      const deletedThroughAt = getChatDeletionWatermark(
        removed.snapshot,
        new Date().toISOString(),
      );
      markGroupChanged(groupId);
      replaceGroups(removed.items);

      return visibilityMutationQueueRef.current.enqueue(
        `${requestedUserId}:${groupId}`,
        async () => {
          let mutationError: unknown = null;
          try {
            const { error: delErr } = await supabase
              .from('chat_participants')
              // Treat deleted_at as a message watermark. A message created after
              // this confirmed snapshot must revive the chat.
              .update({ deleted_at: deletedThroughAt })
              .eq('group_id', groupId)
              .eq('user_id', requestedUserId);
            if (delErr) throw delErr;
          } catch (deleteError) {
            mutationError = deleteError;
          }

          if (!isCurrentUserGeneration(requestedUserId, requestGeneration)) {
            return { status: 'superseded' } as DeleteChatResult;
          }
          const currentIntent = visibilityMutationStateRef.current.get(groupId);
          if (!currentIntent) return { status: 'superseded' } as DeleteChatResult;
          const resolution = settleVersionedIntent(
            currentIntent,
            intentState.version,
            'deleted' as ChatVisibilityIntent,
            mutationError === null,
          );
          if (resolution.next) visibilityMutationStateRef.current.set(groupId, resolution.next);
          else visibilityMutationStateRef.current.delete(groupId);

          if (mutationError === null) {
            if (!resolution.isLatest) return { status: 'superseded' };
            // Reconcile any message that arrived after the captured watermark
            // while the row was optimistically absent.
            void fetchGroups();
            return { status: 'deleted', snapshot: removed.snapshot! };
          }
          if (!resolution.isLatest) return { status: 'superseded' };

          if (resolution.rollbackTo === 'visible') {
            markGroupChanged(groupId);
            updateGroups((current) => restoreChatSnapshot(current, removed.snapshot!));
          }
          void fetchGroups();
          console.warn('[useChatGroups] deleteChat failed', mutationError);
          return { status: 'failed' };
        },
      );
    },
    [
      fetchGroups,
      isCurrentUserGeneration,
      markGroupChanged,
      replaceGroups,
      updateGroups,
      userId,
    ],
  );

  const restoreChat = useCallback(
    async (snapshot: ChatDeletionSnapshot<ChatGroupWithMeta>): Promise<boolean> => {
      const requestedUserId = userId;
      const requestGeneration = requestIdentityRef.current.generation;
      if (!requestedUserId || !isCurrentUserGeneration(requestedUserId, requestGeneration)) {
        return true;
      }
      const groupId = snapshot.item.id;
      const intentState = beginVersionedIntent<ChatVisibilityIntent>(
        visibilityMutationStateRef.current.get(groupId),
        'deleted',
        'visible',
      );
      visibilityMutationStateRef.current.set(groupId, intentState);
      const restored = restoreChatSnapshot(groupsRef.current, snapshot);
      markGroupChanged(groupId);
      replaceGroups(restored);

      return visibilityMutationQueueRef.current.enqueue(
        `${requestedUserId}:${groupId}`,
        async () => {
          let mutationError: unknown = null;
          try {
            const { error: restoreError } = await supabase
              .from('chat_participants')
              .update({ deleted_at: null })
              .eq('group_id', groupId)
              .eq('user_id', requestedUserId);
            if (restoreError) throw restoreError;
          } catch (restoreError) {
            mutationError = restoreError;
          }

          if (!isCurrentUserGeneration(requestedUserId, requestGeneration)) return true;
          const currentIntent = visibilityMutationStateRef.current.get(groupId);
          if (!currentIntent) return true;
          const resolution = settleVersionedIntent(
            currentIntent,
            intentState.version,
            'visible' as ChatVisibilityIntent,
            mutationError === null,
          );
          if (resolution.next) visibilityMutationStateRef.current.set(groupId, resolution.next);
          else visibilityMutationStateRef.current.delete(groupId);

          if (!resolution.isLatest) return true;
          if (mutationError === null) {
            void fetchGroups();
            return true;
          }
          if (resolution.rollbackTo === 'deleted') {
            markGroupChanged(groupId);
            updateGroups((current) => rollbackRestoredChatSnapshot(current, snapshot));
          }
          void fetchGroups();
          console.warn('[useChatGroups] restoreChat failed', mutationError);
          return false;
        },
      );
    },
    [
      fetchGroups,
      isCurrentUserGeneration,
      markGroupChanged,
      replaceGroups,
      updateGroups,
      userId,
    ],
  );

  return {
    groups,
    loading,
    error,
    refetch: fetchGroups,
    createGroup,
    toggleStar,
    deleteChat,
    restoreChat,
  };
}

function useChatGroupsDemo(_userId: string) {
  return {
    groups: demoChatGroups as ChatGroupWithMeta[],
    loading: false,
    error: null as string | null,
    refetch: async () => {},
    createGroup: async (_name: string | null, _participantIds: string[]) => 'group-1',
    toggleStar: async (_groupId: string, _starred: boolean) => true,
    deleteChat: async (groupId: string): Promise<DeleteChatResult> => {
      const snapshot = removeChatWithSnapshot(
        demoChatGroups as ChatGroupWithMeta[],
        groupId,
      ).snapshot;
      return snapshot ? { status: 'deleted', snapshot } : { status: 'superseded' };
    },
    restoreChat: async (_snapshot: ChatDeletionSnapshot<ChatGroupWithMeta>) => true,
  };
}

export const useChatGroups = DEMO_MODE ? useChatGroupsDemo : useChatGroupsReal;
