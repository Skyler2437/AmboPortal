import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { DEMO_MODE, DEMO_USER, demoChatGroups } from '@/lib/demo';
import { syncUnreadMessageBadge } from '@/lib/app-badge';
import {
  createReadAcknowledgementQueue,
  getMonotonicReadFilter,
} from '@/lib/chat-read-acknowledgement';

export interface ChatThreadMeta {
  /** Header title: the group name, or derived from participant names. */
  groupName: string;
  /** Current user's first name (used by the typing indicator). */
  userFirstName: string;
  /** Persist this thread as read (updates chat_participants.last_read_at). */
  markRead: () => Promise<boolean>;
}

function useChatThreadMetaReal(groupId: string, userId: string): ChatThreadMeta {
  const [groupName, setGroupName] = useState('Messages');
  const [userFirstName, setUserFirstName] = useState('');

  // Group name for the header (fall back to participant names if unnamed).
  useEffect(() => {
    if (!groupId) return;
    let disposed = false;
    setGroupName('Messages');
    async function fetchGroupName() {
      const { data: group } = await supabase
        .from('chat_groups')
        .select('name')
        .eq('id', groupId)
        .single();

      if (disposed) return;
      if (group?.name) {
        setGroupName(group.name);
        return;
      }

      const { data: participants } = await supabase
        .from('chat_participants')
        .select('user_id, users(first_name, last_name)')
        .eq('group_id', groupId);

      if (disposed) return;
      if (participants) {
        const others = participants
          .filter((p: any) => p.user_id !== userId && p.users)
          .map((p: any) => p.users.first_name);
        if (others.length > 0) {
          setGroupName(others.join(', '));
        }
      }
    }
    void fetchGroupName();
    return () => {
      disposed = true;
    };
  }, [groupId, userId]);

  // Cache the current user's first name for the typing indicator.
  useEffect(() => {
    if (!userId) return;
    let disposed = false;
    setUserFirstName('');
    void supabase
      .from('users')
      .select('first_name')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (!disposed && data) setUserFirstName((data as any).first_name || '');
      });
    return () => {
      disposed = true;
    };
  }, [userId]);

  const readAcknowledgements = useMemo(() => createReadAcknowledgementQueue(async (readAt) => {
    const { error } = await supabase
      .from('chat_participants')
      .update({ last_read_at: readAt })
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .or(getMonotonicReadFilter(readAt));
    if (error) return false;

    // A zero-row update is also success: another device already persisted an
    // equal or newer read timestamp, so there is nothing left to acknowledge.
    await syncUnreadMessageBadge(userId).catch(() => {});
    return true;
  }), [groupId, userId]);

  const markRead = useCallback(() => {
    if (!groupId || !userId) return Promise.resolve(false);
    return readAcknowledgements.acknowledge();
  }, [groupId, readAcknowledgements, userId]);

  return { groupName, userFirstName, markRead };
}

function useChatThreadMetaDemo(groupId: string, _userId: string): ChatThreadMeta {
  const group = demoChatGroups.find((g) => g.id === groupId);
  return {
    groupName: group?.name || 'Chat',
    userFirstName: DEMO_USER.first_name,
    markRead: async () => true,
  };
}

/** Header/typing metadata + read-receipt action for a chat thread. */
export const useChatThreadMeta = DEMO_MODE ? useChatThreadMetaDemo : useChatThreadMetaReal;
