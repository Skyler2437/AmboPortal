export type UserRole = "basic" | "student" | "admin" | "superadmin" | "applicant";
export type SubmissionStatus = "Pending" | "Approved" | "Denied";
export type RSVPStatus = "going" | "maybe" | "no";
export type EventAttendanceStatus = "present" | "absent" | "excused_absent";

export interface User {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  role: UserRole;
  avatar_url?: string;
}

export interface Submission {
  id: string;
  user_id: string;
  service_date: string;
  service_type: string;
  credits: number;
  hours: number;
  feedback: string | null;
  status: SubmissionStatus;
  created_at?: string;
}

export interface EventRSVPOption {
  id: string;
  event_id: string;
  label: string;
  sort_order: number;
  created_at?: string;
}

export interface EventDetails {
  id: string;
  title: string;
  description: string;
  start_time: string;
  end_time: string;
  type: string;
  created_by: string;
  uniform?: string;
  users?: { role?: string };
  rsvp_options?: EventRSVPOption[];
}

export interface EventComment {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  users: { first_name: string; last_name: string; role?: string; avatar_url?: string };
}

export interface EventRSVP {
  status: RSVPStatus;
  users: { first_name: string; last_name: string };
  user_id: string;
  rsvp_option_id?: string;
  rsvp_option?: EventRSVPOption;
}

export interface EventAttendance {
  event_id: string;
  user_id: string;
  status: EventAttendanceStatus;
}

export const SERVICE_TYPES = [
  "Family Tour",
  "Mock Tour",
  "Shadow Tour",
  "Cancelled Tour",
  "Campus Preview Day",
  "Student Ambassador Retreat",
  "LevelUp!",
  "ES Movie Night",
  "New Faculty Tour",
  "Back to School Night",
  "Lion Look-In",
  "Acts of Kindness",
  "High School Graduation",
  "Entrance Assessment",
  "Veteran's Day Chapel",
  "Move Up Day",
  "Open House",
  "Other",
] as const;
