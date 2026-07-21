import { describe, expect, it } from 'vitest';
import {
  ATTENDANCE_STATUS_CHOICES,
  attendanceStateReducer,
  attendanceStatusAccessibilityLabel,
  buildAttendanceChanges,
  buildAttendanceSections,
  canManageEvent,
  createAttendanceState,
  getAttendanceOwnerKey,
  mergeAttendanceRoster,
  prepareAttendanceSave,
  selectAttendanceState,
  summarizeAttendance,
  type AttendanceStatus,
  type AttendanceRosterStudent,
} from '@/lib/event-attendance';
import { demoAttendanceProfiles, demoEvents } from '@/lib/demo';

const students: AttendanceRosterStudent[] = [
  { id: 'no', firstName: 'Noah', lastName: 'Young', rsvpStatus: 'no', attendanceStatus: null },
  { id: 'none', firstName: 'Alex', lastName: 'Adams', rsvpStatus: null, attendanceStatus: null },
  { id: 'maybe', firstName: 'Maya', lastName: 'Brown', rsvpStatus: 'maybe', attendanceStatus: 'excused_absent' },
  { id: 'going-b', firstName: 'Sam', lastName: 'Chen', rsvpStatus: 'going', attendanceStatus: 'present' },
  { id: 'going-a', firstName: 'Avery', lastName: 'Chen', rsvpStatus: 'going', attendanceStatus: 'absent' },
];

describe('event attendance', () => {
  it('groups Going, Maybe, No RSVP, and Can’t Go and alphabetizes each group', () => {
    expect(buildAttendanceSections(students).map((section) => ({
      key: section.key,
      ids: section.data.map((student) => student.id),
    }))).toEqual([
      { key: 'going', ids: ['going-a', 'going-b'] },
      { key: 'maybe', ids: ['maybe'] },
      { key: 'none', ids: ['none'] },
      { key: 'no', ids: ['no'] },
    ]);
  });

  it('counts missing rows as unmarked', () => {
    expect(summarizeAttendance(students)).toEqual({ present: 1, absent: 1, excused_absent: 1, unmarked: 2 });
  });

  it('merges every student profile with optional RSVP and visible attendance rows', () => {
    expect(mergeAttendanceRoster(
      [
        { id: 'one', first_name: 'Alex', last_name: 'Rivera', avatar_url: 'https://example.test/alex.png' },
        { id: 'two', first_name: 'Maya', last_name: 'Chen' },
        { id: 'three', first_name: 'Sam', last_name: 'Patel' },
      ],
      [
        { user_id: 'one', status: 'going' },
        { user_id: 'two', status: 'maybe' },
      ],
      [
        { user_id: 'one', status: 'present' },
        { user_id: 'three', status: 'excused_absent' },
      ],
    )).toEqual([
      {
        id: 'one',
        firstName: 'Alex',
        lastName: 'Rivera',
        avatarUrl: 'https://example.test/alex.png',
        rsvpStatus: 'going',
        attendanceStatus: 'present',
      },
      {
        id: 'two',
        firstName: 'Maya',
        lastName: 'Chen',
        avatarUrl: undefined,
        rsvpStatus: 'maybe',
        attendanceStatus: null,
      },
      {
        id: 'three',
        firstName: 'Sam',
        lastName: 'Patel',
        avatarUrl: undefined,
        rsvpStatus: null,
        attendanceStatus: 'excused_absent',
      },
    ]);
  });

  it('emits only changed statuses and uses null to clear a row', () => {
    expect(buildAttendanceChanges(
      new Map<string, AttendanceStatus | null>([['one', 'present'], ['two', 'absent']]),
      new Map<string, AttendanceStatus | null>([['one', 'present'], ['two', null], ['three', 'excused_absent']]),
    )).toEqual([
      { user_id: 'two', status: null },
      { user_id: 'three', status: 'excused_absent' },
    ]);
  });

  it('allows admins, superadmins, and only the matching student creator', () => {
    expect(canManageEvent('student-1', 'student', 'student-1')).toBe(true);
    expect(canManageEvent('student-2', 'student', 'student-1')).toBe(false);
    expect(canManageEvent('admin-1', 'admin', 'student-1')).toBe(true);
    expect(canManageEvent('super-1', 'superadmin', 'student-1')).toBe(true);
  });

  it('quarantines the prior roster immediately when the event or actor changes', () => {
    const firstOwner = getAttendanceOwnerKey('event-1', {
      userId: 'student-1',
      role: 'student',
    })!;
    const nextOwner = getAttendanceOwnerKey('event-2', {
      userId: 'admin-1',
      role: 'admin',
    })!;
    let state = createAttendanceState();

    state = attendanceStateReducer(state, { type: 'load-started', ownerKey: firstOwner });
    state = attendanceStateReducer(state, {
      type: 'load-succeeded',
      ownerKey: firstOwner,
      roster: [students[3]],
    });
    state = attendanceStateReducer(state, {
      type: 'status-changed',
      ownerKey: firstOwner,
      userId: students[3].id,
      status: 'absent',
    });

    expect(selectAttendanceState(state, nextOwner)).toMatchObject({
      students: [],
      dirty: false,
      loading: true,
      canEdit: false,
    });

    state = attendanceStateReducer(state, { type: 'load-started', ownerKey: nextOwner });
    expect(state).toMatchObject({ ownerKey: nextOwner, roster: [], loading: true, saving: false });
    expect(state.currentStatuses.size).toBe(0);
  });

  it('ignores a stale attendance response after a newer owner starts loading', () => {
    const firstOwner = getAttendanceOwnerKey('event-1', {
      userId: 'student-1',
      role: 'student',
    })!;
    const nextOwner = getAttendanceOwnerKey('event-2', {
      userId: 'student-1',
      role: 'student',
    })!;
    let state = createAttendanceState();
    state = attendanceStateReducer(state, { type: 'load-started', ownerKey: firstOwner });
    state = attendanceStateReducer(state, { type: 'load-started', ownerKey: nextOwner });

    const afterStaleResponse = attendanceStateReducer(state, {
      type: 'load-succeeded',
      ownerKey: firstOwner,
      roster: [students[3]],
    });

    expect(afterStaleResponse).toBe(state);
    expect(selectAttendanceState(afterStaleResponse, nextOwner)).toMatchObject({
      students: [],
      loading: true,
      canEdit: false,
    });
  });

  it('preserves local selections when a save fails', () => {
    const ownerKey = getAttendanceOwnerKey('event-1', {
      userId: 'admin-1',
      role: 'admin',
    })!;
    let state = createAttendanceState();
    state = attendanceStateReducer(state, { type: 'load-started', ownerKey });
    state = attendanceStateReducer(state, {
      type: 'load-succeeded',
      ownerKey,
      roster: [students[3]],
    });
    state = attendanceStateReducer(state, {
      type: 'status-changed',
      ownerKey,
      userId: students[3].id,
      status: 'absent',
    });
    state = attendanceStateReducer(state, { type: 'save-started', ownerKey });
    state = attendanceStateReducer(state, {
      type: 'save-failed',
      ownerKey,
      error: 'Save failed.',
    });

    expect(selectAttendanceState(state, ownerKey)).toMatchObject({
      students: [expect.objectContaining({ id: students[3].id, attendanceStatus: 'absent' })],
      dirty: true,
      saving: false,
      error: 'Save failed.',
      canEdit: true,
    });
  });

  it('plans only changed rows and refuses saves for stale or loading state', () => {
    const ownerKey = getAttendanceOwnerKey('event-1', {
      userId: 'admin-1',
      role: 'admin',
    })!;
    const staleOwner = getAttendanceOwnerKey('event-2', {
      userId: 'admin-1',
      role: 'admin',
    })!;
    let state = createAttendanceState();
    state = attendanceStateReducer(state, { type: 'load-started', ownerKey });

    expect(prepareAttendanceSave(state, ownerKey, 'event-1')).toBeNull();

    state = attendanceStateReducer(state, {
      type: 'load-succeeded',
      ownerKey,
      roster: [students[3], students[4]],
    });
    state = attendanceStateReducer(state, {
      type: 'status-changed',
      ownerKey,
      userId: students[4].id,
      status: null,
    });

    expect(prepareAttendanceSave(state, ownerKey, 'event-1')).toMatchObject({
      targetEventId: 'event-1',
      changes: [{ user_id: students[4].id, status: null }],
    });
    expect(prepareAttendanceSave(state, staleOwner, 'event-2')).toBeNull();
  });

  it('uses exact attendance semantics in visible and VoiceOver labels', () => {
    expect(ATTENDANCE_STATUS_CHOICES).toEqual([
      { label: 'Present', value: 'present' },
      { label: 'Absent', value: 'absent' },
      { label: 'Excused Absent', value: 'excused_absent' },
      { label: 'Unmarked', value: null },
    ]);
    const unmarked = ATTENDANCE_STATUS_CHOICES.find((choice) => choice.value === null)!;
    expect({
      label: attendanceStatusAccessibilityLabel(students[1], unmarked.label),
      selected: students[1].attendanceStatus === unmarked.value,
    }).toEqual({ label: 'Alex Adams, Unmarked', selected: true });
  });

  it('includes a fabricated event owned by the demo student', () => {
    expect(demoEvents).toContainEqual(expect.objectContaining({
      created_by: demoAttendanceProfiles[0].id,
      users: { role: 'student' },
    }));
  });
});
