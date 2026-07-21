import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UserRole } from '@ambo/database';
import {
  attendanceStateReducer,
  createAttendanceState,
  getAttendanceOwnerKey,
  mergeAttendanceRoster,
  prepareAttendanceSave,
  selectAttendanceState,
  type AttendanceStatus,
} from '@/lib/event-attendance';
import {
  DEMO_MODE,
  demoAttendanceProfiles,
  demoAttendanceRows,
  demoAttendanceRsvps,
} from '@/lib/demo';
import { supabase } from '@/lib/supabase';

export interface EventAttendanceActor {
  userId: string;
  role: UserRole;
}

type AttendanceProfile = Parameters<typeof mergeAttendanceRoster>[0][number];
type AttendanceRsvp = Parameters<typeof mergeAttendanceRoster>[1][number];
type AttendanceRow = Parameters<typeof mergeAttendanceRoster>[2][number];

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error
    ? error.message
    : typeof error === 'object' && error && 'message' in error
      ? String(error.message)
      : fallback;
}

export function useEventAttendance(eventId: string, actor: EventAttendanceActor) {
  const [state, setState] = useState(createAttendanceState);
  const stateRef = useRef(state);
  const operationId = useRef(0);
  const actorUserId = actor.userId;
  const actorRole = actor.role;
  const requestedOwnerKey = getAttendanceOwnerKey(eventId, {
    userId: actorUserId,
    role: actorRole,
  });
  const requestedOwnerKeyRef = useRef(requestedOwnerKey);
  requestedOwnerKeyRef.current = requestedOwnerKey;

  const dispatchAttendance = useCallback((
    action: Parameters<typeof attendanceStateReducer>[1],
  ) => {
    const previous = stateRef.current;
    const next = attendanceStateReducer(previous, action);
    if (next === previous) return false;
    stateRef.current = next;
    setState(next);
    return true;
  }, []);

  const refetch = useCallback(async () => {
    const ownerKey = getAttendanceOwnerKey(eventId, {
      userId: actorUserId,
      role: actorRole,
    });
    const refreshStarted = dispatchAttendance({ type: 'load-started', ownerKey });

    if (!ownerKey || !refreshStarted) return false;
    const activeOperation = ++operationId.current;

    try {
      let profiles: AttendanceProfile[];
      let rsvps: AttendanceRsvp[];
      let attendance: AttendanceRow[];

      if (DEMO_MODE) {
        profiles = demoAttendanceProfiles;
        rsvps = demoAttendanceRsvps;
        attendance = demoAttendanceRows;
      } else {
        const [profilesResult, rsvpsResult, attendanceResult] = await Promise.all([
          supabase.from('users').select('id, first_name, last_name, avatar_url').eq('role', 'student'),
          supabase.from('event_rsvps').select('user_id, status').eq('event_id', eventId),
          supabase.from('event_attendance').select('user_id, status').eq('event_id', eventId),
        ]);

        const queryError = profilesResult.error || rsvpsResult.error || attendanceResult.error;
        if (queryError) throw queryError;

        profiles = (profilesResult.data || []).map((profile) => ({
          id: profile.id,
          first_name: profile.first_name,
          last_name: profile.last_name,
          avatar_url: profile.avatar_url ?? undefined,
        }));
        rsvps = (rsvpsResult.data || []) as AttendanceRsvp[];
        attendance = (attendanceResult.data || []) as AttendanceRow[];
      }

      const merged = mergeAttendanceRoster(profiles, rsvps, attendance);
      if (
        activeOperation !== operationId.current
        || requestedOwnerKeyRef.current !== ownerKey
      ) return;
      dispatchAttendance({ type: 'load-succeeded', ownerKey, roster: merged });
      return true;
    } catch (caught) {
      if (
        activeOperation === operationId.current
        && requestedOwnerKeyRef.current === ownerKey
      ) {
        dispatchAttendance({
          type: 'load-failed',
          ownerKey,
          error: errorMessage(caught, 'Unable to load attendance.'),
        });
      }
      return false;
    }
  }, [actorRole, actorUserId, dispatchAttendance, eventId]);

  useEffect(() => {
    void refetch();
    return () => {
      operationId.current += 1;
    };
  }, [refetch]);

  const selected = useMemo(
    () => selectAttendanceState(state, requestedOwnerKey),
    [requestedOwnerKey, state],
  );

  const setStatus = useCallback((userId: string, status: AttendanceStatus | null) => {
    if (!requestedOwnerKey) return;
    dispatchAttendance({ type: 'status-changed', ownerKey: requestedOwnerKey, userId, status });
  }, [dispatchAttendance, requestedOwnerKey]);

  const save = useCallback(async () => {
    const plan = prepareAttendanceSave(stateRef.current, requestedOwnerKey, eventId);
    if (!plan || !requestedOwnerKey) return false;
    if (plan.changes.length === 0) return true;

    const ownerKey = requestedOwnerKey;
    const saveStarted = dispatchAttendance({ type: 'save-started', ownerKey });
    if (!saveStarted) return false;
    const activeOperation = ++operationId.current;

    try {
      if (!DEMO_MODE) {
        const { error: saveError } = await supabase.rpc('save_event_attendance', {
          target_event_id: plan.targetEventId,
          changes: plan.changes,
        });
        if (saveError) throw saveError;
      }

      if (
        activeOperation !== operationId.current
        || requestedOwnerKeyRef.current !== ownerKey
      ) return false;
      dispatchAttendance({
        type: 'save-succeeded',
        ownerKey,
        savedStatuses: plan.savedStatuses,
      });
      return true;
    } catch (caught) {
      if (
        activeOperation === operationId.current
        && requestedOwnerKeyRef.current === ownerKey
      ) {
        dispatchAttendance({
          type: 'save-failed',
          ownerKey,
          error: errorMessage(caught, 'Unable to save attendance.'),
        });
      }
      return false;
    }
  }, [dispatchAttendance, eventId, requestedOwnerKey]);

  return {
    ...selected,
    setStatus,
    save,
    refetch,
  };
}
