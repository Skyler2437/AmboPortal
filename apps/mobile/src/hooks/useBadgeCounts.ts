import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { supabase } from '@/lib/supabase';
import { useChatReadStore } from '@/stores/chatReadStore';
import { DEMO_MODE } from '@/lib/demo';
import { syncUnreadMessageBadge } from '@/lib/app-badge';

function useBadgeCountsReal(userId: string, role: 'admin' | 'student') {
  const [pendingSubmissions, setPendingSubmissions] = useState(0);
  const [serverUnreadGroupIds, setServerUnreadGroupIds] = useState<Set<string>>(new Set());
  const readGroups = useChatReadStore((s) => s.readGroups);
  const removeReadGroup = useChatReadStore((s) => s.removeReadGroup);
  // Track group IDs so we can scope the realtime subscription
  const groupIdsRef = useRef<string[]>([]);

  const fetchCounts = useCallback(async () => {
    if (!userId) return;

    // Fetch unread chat groups from server
    const unreadGroupIds = new Set<string>();
    try {
      const { data: participantData } = await supabase
        .from('chat_participants')
        .select('group_id, last_read_at')
        .eq('user_id', userId);

      if (participantData && participantData.length > 0) {
        const groupIds = participantData.map((p: any) => p.group_id);
        groupIdsRef.current = groupIds;

        // Build O(1) lookup map for participant data
        const participantMap = new Map<string, string | null>();
        for (const p of participantData) {
          participantMap.set(p.group_id, (p as any).last_read_at ?? null);
        }

        // Fetch recent messages — limit to reduce data transfer
        const { data: latestMessages } = await supabase
          .from('chat_messages')
          .select('group_id, created_at, sender_id')
          .in('group_id', groupIds)
          .order('created_at', { ascending: false })
          .limit(groupIds.length * 3);

        if (latestMessages) {
          const seenGroups = new Set<string>();
          for (const msg of latestMessages) {
            if (msg.sender_id === userId) continue; // Skip own messages
            if (seenGroups.has(msg.group_id)) continue; // Already found latest for this group
            seenGroups.add(msg.group_id);

            const lastRead = participantMap.get(msg.group_id);
            if (lastRead === undefined) continue; // Not a participant (shouldn't happen)
            if (!lastRead || new Date(msg.created_at) > new Date(lastRead)) {
              unreadGroupIds.add(msg.group_id);
            }
          }
        }
      }
    } catch {
      // Silently fail if last_read_at column doesn't exist
    }

    // Only push a new Set when the contents actually changed. Allocating a
    // fresh Set on every fetch forces a re-render even when nothing moved,
    // which — combined with the realtime sub and 15s interval — adds needless
    // re-render pressure to the navigator that mounts this hook.
    setServerUnreadGroupIds((prev) => {
      if (prev.size === unreadGroupIds.size) {
        let identical = true;
        for (const id of unreadGroupIds) {
          if (!prev.has(id)) {
            identical = false;
            break;
          }
        }
        if (identical) return prev;
      }
      return unreadGroupIds;
    });

    // Prune optimistic readGroups for groups the server now considers read.
    // This prevents the optimistic set from growing unbounded and keeps
    // badge state in sync without the race condition of clearing all at once.
    const currentReadGroups = useChatReadStore.getState().readGroups;
    for (const gid of currentReadGroups) {
      if (!unreadGroupIds.has(gid)) {
        removeReadGroup(gid);
      }
    }

    // Fetch pending submissions count (admin sees all, student sees own)
    if (role === 'admin') {
      const { count } = await supabase
        .from('submissions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'Pending');
      setPendingSubmissions(count || 0);
    }
  }, [removeReadGroup, role, userId]);

  useEffect(() => {
    if (!userId) return;

    fetchCounts();

    // Refresh periodically as a fallback
    const interval = setInterval(fetchCounts, 15000);

    // Subscribe to new chat messages — refetch badge counts on any insert
    const channel = supabase
      .channel(`badge-counts-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const newMsg = payload.new as any;
          // Ignore our own messages and inserts for groups we don't belong to.
          // postgres_changes can't filter on `group_id IN (...)`, so without
          // this guard every chat message app-wide triggers a full refetch.
          if (newMsg.sender_id === userId) return;
          if (!groupIdsRef.current.includes(newMsg.group_id)) return;
          removeReadGroup(newMsg.group_id);
          fetchCounts();
          syncUnreadMessageBadge(userId).catch(() => {});
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'submissions' },
        () => {
          // Refetch when any submission status changes (approve/deny)
          if (role === 'admin') fetchCounts();
        }
      )
      .subscribe();

    // Refetch when app comes back to foreground
    const appStateListener = AppState.addEventListener('change', (state) => {
      if (state === 'active') fetchCounts();
    });

    return () => {
      clearInterval(interval);
      appStateListener.remove();
      supabase.removeChannel(channel);
    };
  }, [fetchCounts, removeReadGroup, role, userId]);

  // Derive adjusted unread count: server unread minus optimistically-read groups
  // This recomputes instantly when readGroups changes (no server round-trip needed)
  let unreadChats = 0;
  for (const gid of serverUnreadGroupIds) {
    if (!readGroups.has(gid)) unreadChats++;
  }

  return { unreadChats, pendingSubmissions, refetch: fetchCounts };
}

function useBadgeCountsDemo(_userId: string, role: 'admin' | 'student') {
  return {
    unreadChats: 1,
    pendingSubmissions: role === 'admin' ? 1 : 0,
    refetch: async () => {},
  };
}

export const useBadgeCounts = DEMO_MODE ? useBadgeCountsDemo : useBadgeCountsReal;
