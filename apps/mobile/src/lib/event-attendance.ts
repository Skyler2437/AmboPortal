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
