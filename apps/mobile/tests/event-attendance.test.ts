import { describe, expect, it } from 'vitest';
import {
  buildAttendanceChanges,
  buildAttendanceSections,
  canManageEvent,
  mergeAttendanceRoster,
  summarizeAttendance,
  type AttendanceStatus,
  type AttendanceRosterStudent,
} from '@/lib/event-attendance';

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
});
