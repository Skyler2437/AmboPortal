import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { DialogUser } from '@/components/UserListDialog';

type RelatedUserRow = {
  users: (DialogUser & { avatar_url?: string | null }) | null;
};

function normalizeRelatedUsers(data: unknown[] | null): DialogUser[] {
  return ((data ?? []) as RelatedUserRow[])
    .map((row) => row.users)
    .filter((user): user is DialogUser & { avatar_url?: string | null } => user !== null)
    .map((user) => ({ ...user, avatar_url: user.avatar_url ?? undefined }));
}

export async function loadPresentUsers(eventId: string): Promise<DialogUser[]> {
  const { data, error } = await supabase
    .from('event_attendance')
    .select('users:users!event_attendance_user_id_fkey(id, first_name, last_name, avatar_url)')
    .eq('event_id', eventId)
    .eq('status', 'present');

  if (error) throw error;
  return normalizeRelatedUsers(data);
}

type ViewRequestOwner = {
  eventId: string;
  generation: number;
};

export function useEventViews(eventId: string, userId: string) {
  const generationRef = useRef(0);
  const committedOwnerRef = useRef<ViewRequestOwner | null>(null);
  const countRequestSequenceRef = useRef(0);
  const [viewCountState, setViewCountState] = useState({ eventId, count: 0 });
  const recordedViewKeys = useRef(new Set<string>());
  const viewCount = viewCountState.eventId === eventId ? viewCountState.count : 0;

  const loadViewCount = useCallback(async (owner: ViewRequestOwner) => {
    const requestSequence = countRequestSequenceRef.current + 1;
    countRequestSequenceRef.current = requestSequence;
    const { count, error } = await supabase
      .from('event_views')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', owner.eventId);

    if (error) throw error;
    if (
      committedOwnerRef.current !== owner
      || countRequestSequenceRef.current !== requestSequence
    ) return;
    setViewCountState({ eventId: owner.eventId, count: count ?? 0 });
  }, []);

  useEffect(() => {
    if (!eventId) {
      committedOwnerRef.current = null;
      return;
    }

    const owner = {
      eventId,
      generation: generationRef.current + 1,
    };
    generationRef.current = owner.generation;
    committedOwnerRef.current = owner;
    setViewCountState({ eventId, count: 0 });
    loadViewCount(owner).catch((error) => {
      if (__DEV__) console.warn('[Event Views] Unable to load count:', error);
    });

    return () => {
      if (committedOwnerRef.current === owner) {
        committedOwnerRef.current = null;
      }
    };
  }, [eventId, loadViewCount]);

  const recordView = useCallback(async () => {
    if (!eventId || !userId) return;
    const owner = committedOwnerRef.current;
    if (!owner || owner.eventId !== eventId) return;
    const viewKey = `${eventId}:${userId}`;
    if (recordedViewKeys.current.has(viewKey)) return;
    recordedViewKeys.current.add(viewKey);

    try {
      const { error } = await supabase.from('event_views').upsert(
        { event_id: eventId, user_id: userId },
        { onConflict: 'event_id,user_id', ignoreDuplicates: true },
      );
      if (error) throw error;
      if (committedOwnerRef.current !== owner) return;
      await loadViewCount(owner);
    } catch (error) {
      if (__DEV__) console.warn('[Event Views] Unable to record view:', error);
    }
  }, [eventId, loadViewCount, userId]);

  const loadViewers = useCallback(async (): Promise<DialogUser[]> => {
    const { data, error } = await supabase
      .from('event_views')
      .select('users(id, first_name, last_name, avatar_url)')
      .eq('event_id', eventId)
      .order('viewed_at', { ascending: false });

    if (error) throw error;
    return normalizeRelatedUsers(data);
  }, [eventId]);

  return { viewCount, recordView, loadViewers };
}
