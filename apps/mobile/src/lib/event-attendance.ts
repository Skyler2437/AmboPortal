import type { UserRole } from '@ambo/database';

export type AttendanceStatus = 'present' | 'absent' | 'excused_absent';
export type AttendanceRsvpGroup = 'going' | 'maybe' | 'none' | 'no';

export interface AttendanceRosterStudent {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  rsvpStatus: 'going' | 'maybe' | 'no' | null;
  attendanceStatus: AttendanceStatus | null;
}

export interface AttendanceSection {
  key: AttendanceRsvpGroup;
  title: string;
  data: AttendanceRosterStudent[];
}

export interface AttendanceChange {
  user_id: string;
  status: AttendanceStatus | null;
}

export const ATTENDANCE_STATUS_CHOICES: ReadonlyArray<{
  label: string;
  value: AttendanceStatus | null;
}> = [
  { label: 'Present', value: 'present' },
  { label: 'Absent', value: 'absent' },
  { label: 'Excused Absent', value: 'excused_absent' },
  { label: 'Unmarked', value: null },
];

export function attendanceStatusAccessibilityLabel(
  student: Pick<AttendanceRosterStudent, 'firstName' | 'lastName'>,
  statusLabel: string,
): string {
  return `${student.firstName} ${student.lastName}, ${statusLabel}`;
}

export interface AttendanceOwnerActor {
  userId: string;
  role: UserRole;
}

export type AttendanceOwnerKey = string;

export function getAttendanceOwnerKey(
  eventId: string,
  actor: AttendanceOwnerActor,
): AttendanceOwnerKey | null {
  if (!eventId || !actor.userId) return null;
  return JSON.stringify([eventId, actor.userId, actor.role]);
}

export interface EventAttendanceState {
  ownerKey: AttendanceOwnerKey | null;
  roster: AttendanceRosterStudent[];
  originalStatuses: Map<string, AttendanceStatus | null>;
  currentStatuses: Map<string, AttendanceStatus | null>;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

export type EventAttendanceAction =
  | { type: 'load-started'; ownerKey: AttendanceOwnerKey | null }
  | { type: 'load-succeeded'; ownerKey: AttendanceOwnerKey; roster: AttendanceRosterStudent[] }
  | { type: 'load-failed'; ownerKey: AttendanceOwnerKey; error: string }
  | {
      type: 'status-changed';
      ownerKey: AttendanceOwnerKey;
      userId: string;
      status: AttendanceStatus | null;
    }
  | { type: 'save-started'; ownerKey: AttendanceOwnerKey }
  | {
      type: 'save-succeeded';
      ownerKey: AttendanceOwnerKey;
      savedStatuses: Map<string, AttendanceStatus | null>;
    }
  | { type: 'save-failed'; ownerKey: AttendanceOwnerKey; error: string };

export function createAttendanceState(): EventAttendanceState {
  return {
    ownerKey: null,
    roster: [],
    originalStatuses: new Map(),
    currentStatuses: new Map(),
    loading: false,
    saving: false,
    error: null,
  };
}

export function attendanceStateReducer(
  state: EventAttendanceState,
  action: EventAttendanceAction,
): EventAttendanceState {
  if (action.type === 'load-started') {
    if (!action.ownerKey) return createAttendanceState();
    if (state.ownerKey === action.ownerKey) {
      const dirty = buildAttendanceChanges(
        state.originalStatuses,
        state.currentStatuses,
      ).length > 0;
      if (state.loading || state.saving || dirty) return state;
      return { ...state, loading: true, error: null };
    }
    return { ...createAttendanceState(), ownerKey: action.ownerKey, loading: true };
  }

  if (state.ownerKey !== action.ownerKey) return state;

  switch (action.type) {
    case 'load-succeeded': {
      const statuses = new Map(
        action.roster.map((student) => [student.id, student.attendanceStatus]),
      );
      return {
        ...state,
        roster: action.roster,
        originalStatuses: statuses,
        currentStatuses: new Map(statuses),
        loading: false,
        saving: false,
        error: null,
      };
    }
    case 'load-failed':
      return { ...state, loading: false, saving: false, error: action.error };
    case 'status-changed': {
      if (
        state.loading
        || state.saving
        || !state.currentStatuses.has(action.userId)
        || state.currentStatuses.get(action.userId) === action.status
      ) {
        return state;
      }
      const currentStatuses = new Map(state.currentStatuses);
      currentStatuses.set(action.userId, action.status);
      return { ...state, currentStatuses };
    }
    case 'save-started':
      if (state.loading || state.saving) return state;
      return { ...state, saving: true, error: null };
    case 'save-succeeded':
      return {
        ...state,
        originalStatuses: new Map(action.savedStatuses),
        saving: false,
        error: null,
      };
    case 'save-failed':
      return { ...state, saving: false, error: action.error };
  }
}

export function selectAttendanceState(
  state: EventAttendanceState,
  requestedOwnerKey: AttendanceOwnerKey | null,
) {
  const ownsLoadedState = Boolean(requestedOwnerKey && state.ownerKey === requestedOwnerKey);
  const students = ownsLoadedState
    ? state.roster.map((student) => ({
        ...student,
        attendanceStatus: state.currentStatuses.get(student.id) ?? null,
      }))
    : [];
  const loading = Boolean(requestedOwnerKey) && (!ownsLoadedState || state.loading);
  const changes = ownsLoadedState
    ? buildAttendanceChanges(state.originalStatuses, state.currentStatuses)
    : [];

  return {
    students,
    sections: buildAttendanceSections(students),
    summary: summarizeAttendance(students),
    loading,
    saving: ownsLoadedState && state.saving,
    error: ownsLoadedState ? state.error : null,
    dirty: changes.length > 0,
    canEdit: ownsLoadedState && !loading && !state.saving,
    canRefresh: ownsLoadedState && !loading && !state.saving && changes.length === 0,
  };
}

export function prepareAttendanceSave(
  state: EventAttendanceState,
  requestedOwnerKey: AttendanceOwnerKey | null,
  eventId: string,
) {
  if (
    !requestedOwnerKey
    || state.ownerKey !== requestedOwnerKey
    || state.loading
    || state.saving
  ) {
    return null;
  }

  return {
    targetEventId: eventId,
    changes: buildAttendanceChanges(state.originalStatuses, state.currentStatuses),
    savedStatuses: new Map(state.currentStatuses),
  };
}

export function mergeAttendanceRoster(
  profiles: Array<{ id: string; first_name: string; last_name: string; avatar_url?: string }>,
  rsvps: Array<{ user_id: string; status: 'going' | 'maybe' | 'no' }>,
  attendance: Array<{ user_id: string; status: AttendanceStatus }>,
): AttendanceRosterStudent[] {
  const rsvpByUser = new Map(rsvps.map((rsvp) => [rsvp.user_id, rsvp.status]));
  const attendanceByUser = new Map(attendance.map((entry) => [entry.user_id, entry.status]));

  return profiles.map((profile) => ({
    id: profile.id,
    firstName: profile.first_name,
    lastName: profile.last_name,
    avatarUrl: profile.avatar_url,
    rsvpStatus: rsvpByUser.get(profile.id) ?? null,
    attendanceStatus: attendanceByUser.get(profile.id) ?? null,
  }));
}

const ORDER: AttendanceRsvpGroup[] = ['going', 'maybe', 'none', 'no'];
const TITLES: Record<AttendanceRsvpGroup, string> = {
  going: 'Going',
  maybe: 'Maybe',
  none: 'No RSVP',
  no: "Can't Go",
};

export function buildAttendanceSections(students: AttendanceRosterStudent[]): AttendanceSection[] {
  return ORDER.map((key) => ({
    key,
    title: TITLES[key],
    data: students
      .filter((student) => (student.rsvpStatus ?? 'none') === key)
      .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)),
  }));
}

export function summarizeAttendance(students: AttendanceRosterStudent[]) {
  return students.reduce((summary, student) => {
    summary[student.attendanceStatus ?? 'unmarked'] += 1;
    return summary;
  }, { present: 0, absent: 0, excused_absent: 0, unmarked: 0 } as Record<AttendanceStatus | 'unmarked', number>);
}

export function buildAttendanceChanges(
  original: ReadonlyMap<string, AttendanceStatus | null>,
  current: ReadonlyMap<string, AttendanceStatus | null>,
): AttendanceChange[] {
  return [...current.entries()]
    .filter(([id, status]) => original.get(id) !== status)
    .map(([user_id, status]) => ({ user_id, status }));
}

export function canManageEvent(userId: string, role: UserRole, creatorId: string | null): boolean {
  return role === 'admin' || role === 'superadmin' || (role === 'student' && userId === creatorId);
}
