/**
 * In-app DEMO MODE — serves fabricated fixtures instead of hitting Supabase, so
 * App Store screenshots never expose production data.
 *
 * Enabled at BUILD TIME via `EXPO_PUBLIC_DEMO_MODE=student` (or `=admin`).
 * Unset → DEMO_MODE is false and every consumer falls through to the real
 * implementation, so normal/production builds are byte-for-byte unaffected.
 *
 * Wiring pattern (lint-safe, no conditional hooks): each data hook does a
 * module-level export swap —
 *   export const usePosts = DEMO_MODE ? usePostsDemo : usePostsReal;
 * and the few screens that query Supabase directly short-circuit on DEMO_MODE.
 */
import type { Session } from '@supabase/supabase-js';
import type { UserRole } from '@ambo/database';

const RAW = process.env.EXPO_PUBLIC_DEMO_MODE;
export const DEMO_ROLE: 'admin' | 'student' | null =
  RAW === 'admin' ? 'admin' : RAW === 'student' ? 'student' : null;
export const DEMO_MODE = DEMO_ROLE !== null;

// --- Identity -----------------------------------------------------------------
const STUDENT_ID = '00000000-0000-4000-8000-000000000001';
const ADMIN_ID = '00000000-0000-4000-8000-000000000002';

/** The signed-in demo user (matches the build's role). */
export const DEMO_USER = {
  id: DEMO_ROLE === 'admin' ? ADMIN_ID : STUDENT_ID,
  first_name: DEMO_ROLE === 'admin' ? 'Jordan' : 'Alex',
  last_name: DEMO_ROLE === 'admin' ? 'Lee' : 'Rivera',
  email: DEMO_ROLE === 'admin' ? 'jordan.lee@example.edu' : 'alex.rivera@example.edu',
  phone: DEMO_ROLE === 'admin' ? '5035550142' : '5035550118',
  role: (DEMO_ROLE === 'admin' ? 'admin' : 'student') as UserRole,
  avatar_url: undefined as string | undefined,
};

/** Minimal fake Supabase session — the app only reads session.user.id/email. */
export const DEMO_SESSION = {
  access_token: 'demo-access-token',
  refresh_token: 'demo-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: 4102444800, // year 2100
  user: {
    id: DEMO_USER.id,
    email: DEMO_USER.email,
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  },
} as unknown as Session;

// --- Cast of fake people (for participants, authors, etc.) --------------------
const PEOPLE = {
  alex: { id: STUDENT_ID, first_name: 'Alex', last_name: 'Rivera', avatar_url: undefined as string | undefined, role: 'student' as UserRole },
  jordan: { id: ADMIN_ID, first_name: 'Jordan', last_name: 'Lee', avatar_url: undefined as string | undefined, role: 'admin' as UserRole },
  maya: { id: '00000000-0000-4000-8000-000000000003', first_name: 'Maya', last_name: 'Chen', avatar_url: undefined as string | undefined, role: 'student' as UserRole },
  sam: { id: '00000000-0000-4000-8000-000000000004', first_name: 'Sam', last_name: 'Patel', avatar_url: undefined as string | undefined, role: 'student' as UserRole },
  noah: { id: '00000000-0000-4000-8000-000000000005', first_name: 'Noah', last_name: 'Kim', avatar_url: undefined as string | undefined, role: 'student' as UserRole },
};

// Relative timestamps so the data always looks fresh in screenshots.
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const daysFromNow = (d: number, hour = 15) => {
  const dt = new Date(Date.now() + d * 86_400_000);
  dt.setHours(hour, 0, 0, 0);
  return dt.toISOString();
};

// --- Fixtures -----------------------------------------------------------------

export const demoPosts = [
  {
    id: 'post-1', user_id: PEOPLE.jordan.id,
    content: 'Huge thanks to everyone who helped at Campus Preview Day — 40+ families toured and the feedback was amazing. You all represented us so well! 🎉',
    created_at: hoursAgo(3), users: PEOPLE.jordan,
    comments: [{ count: 4 }], like_count: 12, view_count: 48, liked: true, attachments: [],
  },
  {
    id: 'post-2', user_id: PEOPLE.maya.id,
    content: 'Reminder: sign up for this weekend\'s shadow tours before Friday. Spots are filling up fast!',
    created_at: hoursAgo(20), users: PEOPLE.maya,
    comments: [{ count: 2 }], like_count: 7, view_count: 31, liked: false, attachments: [],
  },
  {
    id: 'post-3', user_id: PEOPLE.sam.id,
    content: 'Had the best time mentoring at LevelUp! today. These students ask the sharpest questions. 💡',
    created_at: hoursAgo(28), users: PEOPLE.sam,
    comments: [{ count: 6 }], like_count: 19, view_count: 64, liked: true, attachments: [],
  },
  {
    id: 'post-4', user_id: PEOPLE.noah.id,
    content: 'New ambassador hoodies are in! Pick yours up from the front office this week.',
    created_at: hoursAgo(50), users: PEOPLE.noah,
    comments: [{ count: 1 }], like_count: 23, view_count: 80, liked: false, attachments: [],
  },
  {
    id: 'post-5', user_id: PEOPLE.alex.id,
    content: 'First tour as lead today and it went great. Thanks to everyone who showed me the ropes 🙏',
    created_at: hoursAgo(72), users: PEOPLE.alex,
    comments: [{ count: 3 }], like_count: 15, view_count: 52, liked: false, attachments: [],
  },
];

export const demoEvents = [
  {
    id: 'event-1', title: 'Campus Preview Day', description: 'All-hands tour day for prospective families. Report to the welcome center at 8:30am.',
    start_time: daysFromNow(2, 9), end_time: daysFromNow(2, 13), type: 'Tour', created_by: PEOPLE.jordan.id,
    uniform: 'Ambassador polo + name tag', users: { role: 'admin' },
    rsvp_options: [], rsvpCounts: { going: 14, maybe: 3 }, myRsvpStatus: 'going', myRsvpOptionLabel: null,
  },
  {
    id: 'event-2', title: 'Shadow Tour Sign-ups', description: 'Pair with a prospective student for a half-day shadow experience.',
    start_time: daysFromNow(5, 10), end_time: daysFromNow(5, 12), type: 'Tour', created_by: PEOPLE.jordan.id,
    uniform: 'Business casual', users: { role: 'admin' },
    rsvp_options: [], rsvpCounts: { going: 8, maybe: 5 }, myRsvpStatus: 'maybe', myRsvpOptionLabel: null,
  },
  {
    id: 'event-3', title: 'Ambassador Retreat', description: 'Annual team retreat — games, training, and planning for the semester.',
    start_time: daysFromNow(9, 8), end_time: daysFromNow(9, 17), type: 'Social', created_by: PEOPLE.jordan.id,
    uniform: 'Casual / outdoor', users: { role: 'admin' },
    rsvp_options: [], rsvpCounts: { going: 21, maybe: 2 }, myRsvpStatus: null, myRsvpOptionLabel: null,
  },
  {
    id: 'event-4', title: 'New Faculty Tour', description: 'Show incoming faculty around campus.',
    start_time: daysFromNow(-3, 11), end_time: daysFromNow(-3, 12), type: 'Tour', created_by: PEOPLE.jordan.id,
    uniform: 'Ambassador polo', users: { role: 'admin' },
    rsvp_options: [], rsvpCounts: { going: 6, maybe: 0 }, myRsvpStatus: 'going', myRsvpOptionLabel: null,
  },
  {
    id: 'event-5', title: 'Student Welcome Crew', description: 'A student-led welcome and campus orientation for incoming ambassadors.',
    start_time: daysFromNow(7, 15), end_time: daysFromNow(7, 17), type: 'Social', created_by: PEOPLE.alex.id,
    uniform: 'Ambassador polo', users: { role: 'student' },
    rsvp_options: [], rsvpCounts: { going: 4, maybe: 0 }, myRsvpStatus: 'going', myRsvpOptionLabel: null,
  },
];

/** Fabricated attendance data for screenshot/demo builds. */
export const demoAttendanceProfiles = [
  { id: PEOPLE.alex.id, first_name: PEOPLE.alex.first_name, last_name: PEOPLE.alex.last_name, avatar_url: PEOPLE.alex.avatar_url },
  { id: PEOPLE.maya.id, first_name: PEOPLE.maya.first_name, last_name: PEOPLE.maya.last_name, avatar_url: PEOPLE.maya.avatar_url },
  { id: PEOPLE.sam.id, first_name: PEOPLE.sam.first_name, last_name: PEOPLE.sam.last_name, avatar_url: PEOPLE.sam.avatar_url },
  { id: PEOPLE.noah.id, first_name: PEOPLE.noah.first_name, last_name: PEOPLE.noah.last_name, avatar_url: PEOPLE.noah.avatar_url },
];

export const demoAttendanceRsvps = [
  { user_id: PEOPLE.alex.id, status: 'going' as const },
  { user_id: PEOPLE.maya.id, status: 'going' as const },
  { user_id: PEOPLE.sam.id, status: 'maybe' as const },
];

export const demoAttendanceRows = [
  { user_id: PEOPLE.alex.id, status: 'present' as const },
  { user_id: PEOPLE.maya.id, status: 'present' as const },
  { user_id: PEOPLE.sam.id, status: 'excused_absent' as const },
];

/** Upcoming events for the student dashboard (id/title/start_time only). */
export const demoUpcomingEvents = demoEvents
  .filter((e) => new Date(e.start_time) >= new Date())
  .sort((a, b) => a.start_time.localeCompare(b.start_time))
  .slice(0, 3)
  .map((e) => ({ id: e.id, title: e.title, start_time: e.start_time }));

export const demoSubmissions = [
  { id: 'sub-1', user_id: DEMO_USER.id, service_date: '2026-06-12', service_type: 'Campus Preview Day', credits: 1, hours: 4, feedback: 'Great energy with families.', status: 'Approved' as const, created_at: hoursAgo(40), users: { first_name: DEMO_USER.first_name, last_name: DEMO_USER.last_name, email: DEMO_USER.email } },
  { id: 'sub-2', user_id: DEMO_USER.id, service_date: '2026-06-08', service_type: 'Shadow Tour', credits: 0.5, hours: 3, feedback: null, status: 'Approved' as const, created_at: hoursAgo(120), users: { first_name: DEMO_USER.first_name, last_name: DEMO_USER.last_name, email: DEMO_USER.email } },
  { id: 'sub-3', user_id: DEMO_USER.id, service_date: '2026-06-15', service_type: 'LevelUp!', credits: 1, hours: 2, feedback: null, status: 'Pending' as const, created_at: hoursAgo(8), users: { first_name: DEMO_USER.first_name, last_name: DEMO_USER.last_name, email: DEMO_USER.email } },
  { id: 'sub-4', user_id: PEOPLE.maya.id, service_date: '2026-06-10', service_type: 'Mock Tour', credits: 0.5, hours: 1.5, feedback: 'Approved — nice work.', status: 'Approved' as const, created_at: hoursAgo(90), users: { first_name: PEOPLE.maya.first_name, last_name: PEOPLE.maya.last_name, email: 'maya.chen@example.edu' } },
  { id: 'sub-5', user_id: PEOPLE.sam.id, service_date: '2026-06-05', service_type: 'Open House', credits: 1, hours: 3, feedback: 'Please add more detail next time.', status: 'Denied' as const, created_at: hoursAgo(160), users: { first_name: PEOPLE.sam.first_name, last_name: PEOPLE.sam.last_name, email: 'sam.patel@example.edu' } },
];

export const demoResources = [
  { id: 'res-1', title: 'Ambassador Handbook 2026', description: 'Everything you need to know about the program.', file_url: 'https://example.com/handbook.pdf', file_type: 'application/pdf', file_size: 2_400_000, uploaded_by: PEOPLE.jordan.id, created_at: hoursAgo(200) },
  { id: 'res-2', title: 'Tour Script & Talking Points', description: 'The standard campus tour route and key highlights.', file_url: 'https://example.com/tour-script.pdf', file_type: 'application/pdf', file_size: 880_000, uploaded_by: PEOPLE.jordan.id, created_at: hoursAgo(320) },
  { id: 'res-3', title: 'Uniform Guidelines', description: 'What to wear for each event type.', file_url: 'https://example.com/uniform.pdf', file_type: 'application/pdf', file_size: 540_000, uploaded_by: PEOPLE.jordan.id, created_at: hoursAgo(500) },
];

export const demoChatGroups = [
  {
    id: 'group-1', name: 'Preview Day Team', created_by: PEOPLE.jordan.id, created_at: hoursAgo(300), updated_at: hoursAgo(1),
    participants: [
      { user_id: PEOPLE.jordan.id, users: PEOPLE.jordan },
      { user_id: DEMO_USER.id, users: { first_name: DEMO_USER.first_name, last_name: DEMO_USER.last_name, avatar_url: undefined } },
      { user_id: PEOPLE.maya.id, users: PEOPLE.maya },
    ],
    lastMessage: { content: 'See everyone at 8:30 sharp! 🌅', created_at: hoursAgo(1), sender_id: PEOPLE.jordan.id },
    hasUnread: true, starred: true,
  },
  {
    id: 'group-2', name: null, created_by: PEOPLE.maya.id, created_at: hoursAgo(220), updated_at: hoursAgo(6),
    participants: [
      { user_id: DEMO_USER.id, users: { first_name: DEMO_USER.first_name, last_name: DEMO_USER.last_name, avatar_url: undefined } },
      { user_id: PEOPLE.maya.id, users: PEOPLE.maya },
    ],
    lastMessage: { content: 'Thanks for covering my tour today!', created_at: hoursAgo(6), sender_id: PEOPLE.maya.id },
    hasUnread: false, starred: false,
  },
  {
    id: 'group-3', name: 'Retreat Planning', created_by: PEOPLE.jordan.id, created_at: hoursAgo(180), updated_at: hoursAgo(28),
    participants: [
      { user_id: PEOPLE.jordan.id, users: PEOPLE.jordan },
      { user_id: DEMO_USER.id, users: { first_name: DEMO_USER.first_name, last_name: DEMO_USER.last_name, avatar_url: undefined } },
      { user_id: PEOPLE.sam.id, users: PEOPLE.sam },
      { user_id: PEOPLE.noah.id, users: PEOPLE.noah },
    ],
    lastMessage: { content: 'I can bring the speakers and games.', created_at: hoursAgo(28), sender_id: PEOPLE.noah.id },
    hasUnread: false, starred: false,
  },
];

/** Messages for the "Preview Day Team" thread (group-1). */
export const demoMessagesByGroup: Record<string, Array<{
  id: string; group_id: string; sender_id: string; content: string; created_at: string;
  status?: 'sending' | 'sent' | 'failed'; like_count?: number; liked?: boolean;
  users: { first_name: string; last_name: string; avatar_url?: string };
}>> = {
  'group-1': [
    { id: 'm1', group_id: 'group-1', sender_id: PEOPLE.jordan.id, content: 'Hey team! Quick brief for Preview Day tomorrow.', created_at: hoursAgo(5), like_count: 0, liked: false, users: PEOPLE.jordan },
    { id: 'm2', group_id: 'group-1', sender_id: PEOPLE.maya.id, content: 'Ready to go! What time should we arrive?', created_at: hoursAgo(4.5), like_count: 1, liked: false, users: PEOPLE.maya },
    { id: 'm3', group_id: 'group-1', sender_id: PEOPLE.jordan.id, content: '8:30am at the welcome center. Wear your polos 👕', created_at: hoursAgo(4), like_count: 2, liked: true, users: PEOPLE.jordan },
    { id: 'm4', group_id: 'group-1', sender_id: DEMO_USER.id, content: 'Got it — I\'ll bring the sign-in tablets.', created_at: hoursAgo(2), like_count: 1, liked: false, users: { first_name: DEMO_USER.first_name, last_name: DEMO_USER.last_name } },
    { id: 'm5', group_id: 'group-1', sender_id: PEOPLE.jordan.id, content: 'See everyone at 8:30 sharp! 🌅', created_at: hoursAgo(1), like_count: 0, liked: false, users: PEOPLE.jordan },
  ],
};

/** Admin dashboard counts. */
export const demoAdminCounts = {
  pendingCount: 1,
  userCount: 50,
  applicationCount: 4,
  submissionCount: 22,
};

/** Student dashboard approved-submission stats. */
export const demoStudentStats = {
  totalHours: 7,
  totalCredits: 1.5,
  totalSubmissions: 3,
};

export const demoNotificationPrefs = {
  chat_messages: true,
  new_posts: true,
  post_comments: true,
  event_comments: true,
  event_reminders: true,
};
