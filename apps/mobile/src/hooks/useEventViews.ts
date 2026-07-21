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
    .select('users(id, first_name, last_name, avatar_url)')
    .eq('event_id', eventId)
    .eq('status', 'present');

  if (error) throw error;
  return normalizeRelatedUsers(data);
}

export function useEventViews(eventId: string, userId: string) {
  const [viewCount, setViewCount] = useState(0);
  const recordedViewKey = useRef<string | null>(null);

  const loadViewCount = useCallback(async () => {
    const { count, error } = await supabase
      .from('event_views')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', eventId);

    if (error) throw error;
    setViewCount(count ?? 0);
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    loadViewCount().catch((error) => {
      if (__DEV__) console.warn('[Event Views] Unable to load count:', error);
    });
  }, [eventId, loadViewCount]);

  const recordView = useCallback(async () => {
    if (!eventId || !userId) return;
    const viewKey = `${eventId}:${userId}`;
    if (recordedViewKey.current === viewKey) return;
    recordedViewKey.current = viewKey;

    try {
      const { error } = await supabase.from('event_views').upsert(
        { event_id: eventId, user_id: userId },
        { onConflict: 'event_id,user_id', ignoreDuplicates: true },
      );
      if (error) throw error;
      await loadViewCount();
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
