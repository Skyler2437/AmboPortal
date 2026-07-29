import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { EventComment, EventRSVP, EventRSVPOption, RSVPStatus } from '@ambo/database';

const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL || '';

export function useEventDetail(eventId: string, userId: string) {
  const [comments, setComments] = useState<EventComment[]>([]);
  const [rsvps, setRsvps] = useState<EventRSVP[]>([]);
  const [rsvpOptions, setRsvpOptions] = useState<EventRSVPOption[]>([]);
  const [myRsvp, setMyRsvp] = useState<RSVPStatus | null>(null);
  const [myRsvpOptionId, setMyRsvpOptionId] = useState<string | null>(null);
  const [myRsvpExplanation, setMyRsvpExplanation] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);

    const [commentsRes, rsvpsRes, optionsRes, explanationsRes] = await Promise.all([
      supabase
        .from('event_comments')
        .select('*, users(first_name, last_name, role, avatar_url)')
        .eq('event_id', eventId)
        .order('created_at', { ascending: true }),
      supabase
        .from('event_rsvps')
        .select('status, user_id, rsvp_option_id, users(first_name, last_name)')
        .eq('event_id', eventId),
      supabase
        .from('event_rsvp_options')
        .select('*')
        .eq('event_id', eventId)
        .order('sort_order', { ascending: true }),
      supabase
        .from('event_rsvp_explanations')
        .select('user_id, explanation')
        .eq('event_id', eventId),
    ]);

    if (commentsRes.data) setComments((commentsRes.data as unknown as EventComment[]).filter((c: any) => c.users != null));
    if (rsvpsRes.data) {
      const explanationByUser = new Map(
        (explanationsRes.data || []).map((row: any) => [row.user_id, row.explanation]),
      );
      const visibleRsvps = (rsvpsRes.data as unknown as EventRSVP[])
        .filter((r: any) => r.users != null)
        .map((rsvp) => {
          const explanation = explanationByUser.get(rsvp.user_id);
          return explanation ? { ...rsvp, explanation } : rsvp;
        });
      setRsvps(visibleRsvps);
      const mine = rsvpsRes.data.find((r: any) => r.user_id === userId);
      setMyRsvp(mine ? (mine.status as RSVPStatus) : null);
      setMyRsvpOptionId(mine?.rsvp_option_id || null);
      setMyRsvpExplanation(
        mine ? (explanationByUser.get(userId) as string | undefined) || null : null,
      );
    }
    if (optionsRes.data) setRsvpOptions(optionsRes.data as EventRSVPOption[]);
    setLoading(false);
  }, [eventId, userId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /** Fire-and-forget Google Calendar sync via the web API */
  const triggerGcalSync = useCallback(async () => {
    if (!WEB_URL) {
      if (__DEV__) console.log('[GCal] No WEB_URL configured — skipping sync');
      return;
    }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        if (__DEV__) console.log('[GCal] No access token — skipping sync');
        return;
      }
      if (__DEV__) console.log('[GCal] Triggering sync for event', eventId, '→', `${WEB_URL}/api/events/${eventId}/gcal-sync`);
      fetch(`${WEB_URL}/api/events/${eventId}/gcal-sync`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
        .then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (body.synced) {
            if (__DEV__) console.log('[GCal] ✅ Sync succeeded for event', eventId);
          } else {
            if (__DEV__) console.warn('[GCal] ❌ Sync failed:', body.reason || `HTTP ${res.status}`);
          }
        })
        .catch((err) => { if (__DEV__) console.warn('[GCal] ❌ Sync request error:', err?.message || err); });
    } catch {
      // silently ignore — GCal sync is best-effort
    }
  }, [eventId]);

  /** Remove RSVP entirely (toggle-off) */
  const removeRsvp = useCallback(async () => {
    // Optimistic: clear immediately
    const prevMyRsvp = myRsvp;
    const prevMyRsvpOptionId = myRsvpOptionId;
    const prevRsvps = rsvps;
    setMyRsvp(null);
    setMyRsvpOptionId(null);
    setMyRsvpExplanation(null);
    setRsvps(rsvps.filter((r: any) => r.user_id !== userId));

    const { error } = await supabase
      .from('event_rsvps')
      .delete()
      .eq('event_id', eventId)
      .eq('user_id', userId);

    if (error) {
      // Revert on failure
      setMyRsvp(prevMyRsvp);
      setMyRsvpOptionId(prevMyRsvpOptionId);
      setMyRsvpExplanation(
        prevRsvps.find((rsvp) => rsvp.user_id === userId)?.explanation || null,
      );
      setRsvps(prevRsvps);
      return error;
    }

    await fetchData();
    triggerGcalSync();
    return null;
  }, [eventId, userId, fetchData, triggerGcalSync, myRsvp, myRsvpOptionId, rsvps]);

  const updateRsvp = useCallback(
    async (status: RSVPStatus, rsvpOptionId?: string, explanation?: string) => {
      const cleanExplanation = explanation?.trim() || '';
      if (
        (status === 'maybe' || status === 'no')
        && (cleanExplanation.length < 50 || cleanExplanation.length > 500)
      ) {
        return new Error('Please explain your response in 50–500 characters.');
      }

      // Toggle-off: if tapping the same status (and same option for custom), remove RSVP
      const sameStatus = status === myRsvp;
      const sameOption = rsvpOptionId === myRsvpOptionId || (!rsvpOptionId && !myRsvpOptionId);
      if (sameStatus && sameOption && explanation === undefined) {
        return removeRsvp();
      }

      // Optimistic update — immediately reflect the change in UI
      const prevMyRsvp = myRsvp;
      const prevMyRsvpOptionId = myRsvpOptionId;
      const prevMyRsvpExplanation = myRsvpExplanation;
      const prevRsvps = rsvps;
      setMyRsvp(status);
      setMyRsvpOptionId(rsvpOptionId || null);
      setMyRsvpExplanation(
        status === 'maybe' || status === 'no' ? cleanExplanation : null,
      );

      // Optimistically update the rsvps array for counts
      const existingIdx = rsvps.findIndex((r: any) => r.user_id === userId);
      if (existingIdx >= 0) {
        const updated = [...rsvps];
        updated[existingIdx] = {
          ...updated[existingIdx],
          status,
          rsvp_option_id: rsvpOptionId || null,
          explanation: status === 'maybe' || status === 'no' ? cleanExplanation : undefined,
        } as any;
        setRsvps(updated);
      }

      const { error } = await supabase.rpc('save_event_rsvp', {
        target_event_id: eventId,
        target_status: status,
        target_rsvp_option_id: rsvpOptionId || null,
        target_explanation: status === 'maybe' || status === 'no' ? cleanExplanation : null,
      });

      if (error) {
        // Revert optimistic update on failure
        setMyRsvp(prevMyRsvp);
        setMyRsvpOptionId(prevMyRsvpOptionId);
        setMyRsvpExplanation(prevMyRsvpExplanation);
        setRsvps(prevRsvps);
        return error;
      }

      // Refetch to get server-truth (includes any new RSVPs from others)
      await fetchData();

      // Trigger Google Calendar sync in background
      triggerGcalSync();

      return null;
    },
    [eventId, userId, fetchData, triggerGcalSync, myRsvp, myRsvpOptionId, myRsvpExplanation, rsvps, removeRsvp]
  );

  const postComment = useCallback(
    async (content: string) => {
      const { error } = await supabase
        .from('event_comments')
        .insert({ event_id: eventId, user_id: userId, content });

      if (!error) await fetchData();
      return error;
    },
    [eventId, userId, fetchData]
  );

  return {
    comments,
    rsvps,
    rsvpOptions,
    myRsvp,
    myRsvpOptionId,
    myRsvpExplanation,
    loading,
    refetch: fetchData,
    updateRsvp,
    removeRsvp,
    postComment,
  };
}
