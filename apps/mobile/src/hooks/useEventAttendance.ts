import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UserRole } from '@ambo/database';
import {
  buildAttendanceChanges,
  buildAttendanceSections,
  mergeAttendanceRoster,
  summarizeAttendance,
  type AttendanceRosterStudent,
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
  const [roster, setRoster] = useState<AttendanceRosterStudent[]>([]);
  const [originalStatuses, setOriginalStatuses] = useState<Map<string, AttendanceStatus | null>>(new Map());
  const [currentStatuses, setCurrentStatuses] = useState<Map<string, AttendanceStatus | null>>(new Map());
  const [loading, setLoading] = useState(Boolean(eventId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const refetch = useCallback(async () => {
    const activeRequest = ++requestId.current;

    if (!eventId || !actor.userId) {
      setRoster([]);
      setOriginalStatuses(new Map());
      setCurrentStatuses(new Map());
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

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
      const statuses = new Map(merged.map((student) => [student.id, student.attendanceStatus]));

      if (activeRequest !== requestId.current) return;
      setRoster(merged);
      setOriginalStatuses(statuses);
      setCurrentStatuses(new Map(statuses));
    } catch (caught) {
      if (activeRequest === requestId.current) {
        setError(errorMessage(caught, 'Unable to load attendance.'));
      }
    } finally {
      if (activeRequest === requestId.current) setLoading(false);
    }
  }, [actor.userId, eventId]);

  useEffect(() => {
    void refetch();
    return () => {
      requestId.current += 1;
    };
  }, [refetch]);

  const students = useMemo(
    () => roster.map((student) => ({
      ...student,
      attendanceStatus: currentStatuses.get(student.id) ?? null,
    })),
    [currentStatuses, roster],
  );

  const sections = useMemo(() => buildAttendanceSections(students), [students]);
  const summary = useMemo(() => summarizeAttendance(students), [students]);
  const changes = useMemo(
    () => buildAttendanceChanges(originalStatuses, currentStatuses),
    [currentStatuses, originalStatuses],
  );

  const setStatus = useCallback((userId: string, status: AttendanceStatus | null) => {
    setCurrentStatuses((previous) => {
      if (!previous.has(userId) || previous.get(userId) === status) return previous;
      const next = new Map(previous);
      next.set(userId, status);
      return next;
    });
  }, []);

  const save = useCallback(async () => {
    const pendingChanges = buildAttendanceChanges(originalStatuses, currentStatuses);
    if (pendingChanges.length === 0) return true;

    const savedSnapshot = new Map(currentStatuses);
    setSaving(true);
    setError(null);

    try {
      if (!DEMO_MODE) {
        const { error: saveError } = await supabase.rpc('save_event_attendance', {
          target_event_id: eventId,
          changes: pendingChanges,
        });
        if (saveError) throw saveError;
      }

      setOriginalStatuses(savedSnapshot);
      return true;
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to save attendance.'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [currentStatuses, eventId, originalStatuses]);

  return {
    students,
    sections,
    summary,
    loading,
    error,
    saving,
    dirty: changes.length > 0,
    setStatus,
    save,
    refetch,
  };
}
