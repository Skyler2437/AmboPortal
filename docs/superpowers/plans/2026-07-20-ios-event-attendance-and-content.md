# iOS Event Attendance and Content Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add event viewers, privacy-safe attendance, reliable chat-style comment composers, compact post controls, the standard event uniform, and complete student post/event ownership flows to the AmboPortal iOS app.

**Architecture:** The authenticated mobile client reads event engagement data through Supabase with RLS. Event views are idempotent rows; attendance is normalized and saved through one authorization-checking PostgreSQL function so a roster update is atomic. Existing bearer-authenticated web routes remain responsible for event mutation and Google Calendar synchronization, with creator-aware authorization added for student-owned events.

**Tech Stack:** Expo SDK 55, React Native 0.83, React 19, Expo Router, React Native Paper, TypeScript, Supabase/PostgreSQL RLS and RPC, Next.js 14 API routes, Vitest.

## Global Constraints

- Use existing AmboPortal theme tokens and components; do not hardcode new colors, spacing, or radii.
- Attendance roster order is Going, Maybe, No RSVP, Can't Go; sort by last name then first name inside each section.
- `unmarked` means no attendance row and must never be treated as absent.
- All authenticated students may see Present names; only admins, superadmins, and the event creator may see Absent, Excused Absent, and Unmarked details.
- Students publish posts and events immediately. A student may edit/delete and manage attendance only for an event they created.
- The exact default uniform copy is `Ambo polo with khaki or navy pants/shorts (appropriate length).`
- A viewer is recorded only after event detail opens, never from list visibility.
- No real student names or records in fixtures, screenshots, logs, or committed demo content.
- Apply production DDL only to AmboPortal project `lazwwkysaygqkskpbzbd`, one migration at a time, following `docs/supabase-migration-runbook.md`.
- Test mobile acceptance with `npx expo run:ios --configuration Release`; do not use Metro/dev client for acceptance.
- Do not push until Skyler confirms the Release build is good.
- EAS production build and App Store submission are not authorized by this plan.
- Before Vercel preview checks, strongly prefer upgrading the local Vercel CLI from 56.3.1 to 56.4.1 or newer with `npm i -g vercel@latest`.

## File Map

- Create `apps/mobile/src/lib/event-attendance.ts`: attendance types, permission predicate, roster grouping, summaries, and save-delta calculation.
- Create `apps/mobile/tests/event-attendance.test.ts`: pure attendance behavior tests.
- Modify `packages/database/src/types.ts`: shared event-view and attendance row types.
- Create `apps/web/supabase/migrations/20260720_event_views_attendance.sql`: tables, indexes, grants, RLS, creator policies, and atomic attendance RPC.
- Create `apps/web/src/lib/eventPermissions.ts`: shared API authorization predicate.
- Create `apps/web/tests/unit/event-permissions.test.ts`: authorization matrix.
- Modify `apps/web/src/app/api/events/[id]/route.ts`: allow a student creator to update/delete only their event.
- Modify `apps/web/src/app/api/mobile/sync-event/route.ts`: allow a student creator to sync only their event.
- Create `apps/mobile/src/hooks/useEventViews.ts`: view insert/count/list behavior.
- Create `apps/mobile/src/hooks/useEventAttendance.ts`: authorized roster read and atomic save.
- Create `apps/mobile/src/screens/EventAttendanceScreen.tsx`: themed, grouped attendance editor.
- Create `apps/mobile/app/(admin)/events/attendance/[id].tsx`: admin route wrapper.
- Create `apps/mobile/app/(student)/events/attendance/[id].tsx`: student route wrapper.
- Modify both `apps/mobile/app/(admin)/events/_layout.tsx` and `apps/mobile/app/(student)/events/_layout.tsx`: register attendance screens.
- Modify `apps/mobile/src/screens/EventDetailScreen.tsx`: creator actions, viewers, Present list, attendance navigation, and shared composer.
- Create `apps/mobile/src/components/ComposerInput.tsx`: controlled shared rounded composer UI.
- Create `apps/mobile/src/lib/composer-state.ts`: draft submission state helper.
- Create `apps/mobile/tests/composer-state.test.ts`: preserve-on-failure and clear-on-success tests.
- Modify `apps/mobile/src/components/ChatInput.tsx`: delegate rendering to `ComposerInput` without changing chat semantics.
- Modify `apps/mobile/src/screens/PostDetailScreen.tsx`: shared comment composer and icon-only post actions.
- Modify `apps/mobile/src/screens/NewEventScreen.tsx`: exact prefilled uniform and completed student event creation errors.
- Create `packages/database/src/constants.ts`: one shared exact uniform default.
- Modify `packages/database/src/index.ts`: export the shared uniform constant.
- Modify `apps/web/src/app/api/events/route.ts`: exact matching uniform fallback.
- Modify `apps/web/tests/unit/events-create.test.ts`: uniform fallback contract.
- Modify `apps/mobile/src/lib/demo.ts`: privacy-safe event view and attendance demo records consumed by the new hooks.

---

### Task 1: Attendance Domain Model

**Files:**
- Create: `apps/mobile/src/lib/event-attendance.ts`
- Create: `apps/mobile/tests/event-attendance.test.ts`
- Modify: `packages/database/src/types.ts`

**Interfaces:**
- Produces `AttendanceStatus`, `AttendanceRosterStudent`, `AttendanceSection`, `AttendanceChange`, `buildAttendanceSections`, `summarizeAttendance`, `buildAttendanceChanges`, and `canManageEvent` for later hooks/screens.
- Consumes existing `UserRole` and RSVP status strings.

- [ ] **Step 1: Write failing domain tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  buildAttendanceChanges,
  buildAttendanceSections,
  canManageEvent,
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
```

- [ ] **Step 2: Run the test and confirm the missing-module failure**

Run: `npm test --prefix apps/mobile -- event-attendance.test.ts`

Expected: FAIL because `@/lib/event-attendance` does not exist.

- [ ] **Step 3: Implement the pure attendance model**

```ts
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
  going: 'Going', maybe: 'Maybe', none: 'No RSVP', no: "Can't Go",
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
```

Add matching shared row types to `packages/database/src/types.ts` and export them from `packages/database/src/index.ts`.

- [ ] **Step 4: Run the focused and full mobile tests**

Run: `npm test --prefix apps/mobile -- event-attendance.test.ts`

Expected: PASS.

Run: `npm test --prefix apps/mobile`

Expected: all mobile tests PASS.

- [ ] **Step 5: Commit the domain model**

```bash
git add apps/mobile/src/lib/event-attendance.ts apps/mobile/tests/event-attendance.test.ts packages/database/src/types.ts packages/database/src/index.ts
git commit -m "feat(mobile): add event attendance domain model"
```

### Task 2: Database Tables, Privacy Policies, and Atomic Save

**Files:**
- Create: `apps/web/supabase/migrations/20260720_event_views_attendance.sql`

**Interfaces:**
- Produces tables `event_views`, `event_attendance`, function `can_manage_event(check_event_id uuid)`, and RPC `save_event_attendance(target_event_id uuid, changes jsonb)`.
- RPC input rows use `{ "user_id": "uuid", "status": "present" | "absent" | "excused_absent" | null }`.

- [ ] **Step 1: Inspect live policies read-only before writing SQL**

Using the authenticated Supabase connection, confirm the target is exactly `AmboPortal — lazwwkysaygqkskpbzbd`, then inspect `pg_policies`, grants, columns, constraints, and indexes for `events`, `event_rsvp_options`, and `posts`.

Expected: document whether the local `20260613_student_create_events.sql` policy is already live and whether `posts` INSERT enforces `user_id = auth.uid()`. Do not apply anything in this step.

- [ ] **Step 2: Write the migration with complete authorization**

The migration must include this contract (use fully qualified objects throughout):

```sql
create table if not exists public.event_views (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  unique (event_id, user_id)
);
create index if not exists idx_event_views_event_id on public.event_views(event_id);
create index if not exists idx_event_views_user_id on public.event_views(user_id);
alter table public.event_views enable row level security;
grant select, insert on public.event_views to authenticated;

create table if not exists public.event_attendance (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null check (status in ('present', 'absent', 'excused_absent')),
  recorded_by uuid not null references public.users(id),
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index if not exists idx_event_attendance_user_id on public.event_attendance(user_id);
alter table public.event_attendance enable row level security;
revoke all on public.event_attendance from anon, authenticated;
grant select on public.event_attendance to authenticated;

create or replace function public.can_manage_event(check_event_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.events e
    join public.users u on u.id = auth.uid()
    where e.id = check_event_id
      and (u.role in ('admin', 'superadmin') or e.created_by = auth.uid())
  );
$$;
revoke all on function public.can_manage_event(uuid) from public;
grant execute on function public.can_manage_event(uuid) to authenticated;

drop policy if exists event_views_select_authenticated on public.event_views;
create policy event_views_select_authenticated on public.event_views
  for select to authenticated using (true);
drop policy if exists event_views_insert_own on public.event_views;
create policy event_views_insert_own on public.event_views
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists event_attendance_select_visible on public.event_attendance;
create policy event_attendance_select_visible on public.event_attendance
  for select to authenticated
  using (
    public.can_manage_event(event_id)
    or (
      status = 'present'
      and exists (
        select 1 from public.users u
        where u.id = auth.uid()
          and u.role in ('student', 'admin', 'superadmin')
      )
    )
  );
```

Implement the atomic RPC with these exact parameter names so the mobile call and PostgreSQL signature match:

```sql
create or replace function public.save_event_attendance(
  target_event_id uuid,
  changes jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  change_row jsonb;
  changed_user_id uuid;
  changed_status text;
  seen_user_ids uuid[] := array[]::uuid[];
begin
  if auth.uid() is null or not public.can_manage_event(target_event_id) then
    raise exception 'Not authorized to manage this event' using errcode = '42501';
  end if;

  if jsonb_typeof(changes) <> 'array' then
    raise exception 'changes must be a JSON array' using errcode = '22023';
  end if;

  for change_row in select value from jsonb_array_elements(changes)
  loop
    begin
      changed_user_id := (change_row ->> 'user_id')::uuid;
    exception when others then
      raise exception 'Each change requires a valid user_id' using errcode = '22023';
    end;

    if changed_user_id = any(seen_user_ids) then
      raise exception 'Duplicate user_id in attendance changes' using errcode = '22023';
    end if;
    seen_user_ids := array_append(seen_user_ids, changed_user_id);

    if not exists (
      select 1 from public.users
      where id = changed_user_id and role = 'student'
    ) then
      raise exception 'Attendance target must be a student' using errcode = '22023';
    end if;

    changed_status := change_row ->> 'status';
    if changed_status is null then
      delete from public.event_attendance
      where event_id = target_event_id and user_id = changed_user_id;
    elsif changed_status in ('present', 'absent', 'excused_absent') then
      insert into public.event_attendance(event_id, user_id, status, recorded_by, updated_at)
      values (target_event_id, changed_user_id, changed_status, auth.uid(), now())
      on conflict (event_id, user_id) do update
      set status = excluded.status,
          recorded_by = excluded.recorded_by,
          updated_at = excluded.updated_at;
    else
      raise exception 'Invalid attendance status' using errcode = '22023';
    end if;
  end loop;
end;
$$;
revoke all on function public.save_event_attendance(uuid, jsonb) from public;
grant execute on function public.save_event_attendance(uuid, jsonb) to authenticated;
```

Replace event INSERT/UPDATE/DELETE and RSVP-option mutation policies so:

- event INSERT requires role student/admin/superadmin and `created_by = auth.uid()`;
- event UPDATE/DELETE uses `public.can_manage_event(id)`;
- RSVP options are readable by authenticated users and mutable only when `public.can_manage_event(event_id)`;
- production post INSERT is verified as self-attributed; if it is not, replace its INSERT policy with `user_id = auth.uid()` for authenticated callers rather than adding a permissive policy beside it.

Use these event and RSVP-option policy definitions after dropping the historical policy names with `drop policy if exists`:

```sql
create policy events_insert_own on public.events
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('student', 'admin', 'superadmin')
    )
  );

create policy events_update_manager on public.events
  for update to authenticated
  using (public.can_manage_event(id))
  with check (public.can_manage_event(id));

create policy events_delete_manager on public.events
  for delete to authenticated
  using (public.can_manage_event(id));

create policy event_rsvp_options_insert_manager on public.event_rsvp_options
  for insert to authenticated
  with check (public.can_manage_event(event_id));
create policy event_rsvp_options_update_manager on public.event_rsvp_options
  for update to authenticated
  using (public.can_manage_event(event_id))
  with check (public.can_manage_event(event_id));
create policy event_rsvp_options_delete_manager on public.event_rsvp_options
  for delete to authenticated
  using (public.can_manage_event(event_id));
```

For posts, the read-only inspection determines the exact historical INSERT policy names. Drop every permissive authenticated/anon INSERT policy identified by that query, then create exactly one client INSERT policy:

```sql
create policy posts_insert_own on public.posts
  for insert to authenticated
  with check (user_id = auth.uid());
```

Do not drop SELECT, UPDATE, or DELETE policies during this post INSERT correction.

- [ ] **Step 3: Perform static migration review**

Run:

```bash
rg -n "security definer|set search_path|revoke all|grant execute|enable row level security|auth.uid" apps/web/supabase/migrations/20260720_event_views_attendance.sql
git diff --check -- apps/web/supabase/migrations/20260720_event_views_attendance.sql
```

Expected: every definer function has `set search_path = ''`, public execution is revoked, RLS is enabled on both tables, and `git diff --check` is clean.

- [ ] **Step 4: Commit the reviewed migration file without applying it yet**

```bash
git add apps/web/supabase/migrations/20260720_event_views_attendance.sql
git commit -m "feat(db): add event views and attendance"
```

### Task 3: Creator-Aware Web API Authorization

**Files:**
- Create: `apps/web/src/lib/eventPermissions.ts`
- Create: `apps/web/tests/unit/event-permissions.test.ts`
- Modify: `apps/web/src/app/api/events/[id]/route.ts`
- Modify: `apps/web/src/app/api/mobile/sync-event/route.ts`

**Interfaces:**
- Produces `canManageEvent(user, eventCreatedBy): boolean` and `authorizeEvent(actor, eventId, loadCreator)` for both routes.
- Consumes `{ userId: string; role: string }` from existing cookie/bearer authentication and `events.created_by` from the admin client.

- [ ] **Step 1: Write the failing permission matrix test**

```ts
import { describe, expect, it } from 'vitest';
import { authorizeEvent, canManageEvent } from '@/lib/eventPermissions';

describe('canManageEvent', () => {
  it.each([
    [{ userId: 'owner', role: 'student' }, 'owner', true],
    [{ userId: 'other', role: 'student' }, 'owner', false],
    [{ userId: 'admin', role: 'admin' }, 'owner', true],
    [{ userId: 'super', role: 'superadmin' }, 'owner', true],
    [{ userId: 'applicant', role: 'applicant' }, 'applicant', false],
  ])('checks role and ownership', (user, createdBy, expected) => {
    expect(canManageEvent(user, createdBy)).toBe(expected);
  });

  it('returns not_found without authorizing a missing event', async () => {
    await expect(authorizeEvent(
      { userId: 'admin', role: 'admin' },
      'missing',
      async () => null,
    )).resolves.toEqual({ status: 'not_found' });
  });

  it('loads ownership and returns allowed or forbidden', async () => {
    const loadCreator = async () => 'owner';
    await expect(authorizeEvent(
      { userId: 'owner', role: 'student' },
      'event-1',
      loadCreator,
    )).resolves.toEqual({ status: 'allowed', createdBy: 'owner' });
    await expect(authorizeEvent(
      { userId: 'other', role: 'student' },
      'event-1',
      loadCreator,
    )).resolves.toEqual({ status: 'forbidden', createdBy: 'owner' });
  });
});
```

Run: `npm test --prefix apps/web -- event-permissions.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement the shared predicate**

```ts
export interface EventActor { userId: string; role: string }
export type EventAuthorization =
  | { status: 'allowed'; createdBy: string | null }
  | { status: 'forbidden'; createdBy: string | null }
  | { status: 'not_found' };

export function canManageEvent(actor: EventActor, createdBy: string | null): boolean {
  return actor.role === 'admin'
    || actor.role === 'superadmin'
    || (actor.role === 'student' && actor.userId === createdBy);
}

export async function authorizeEvent(
  actor: EventActor,
  eventId: string,
  loadCreator: (eventId: string) => Promise<string | null | undefined>,
): Promise<EventAuthorization> {
  const createdBy = await loadCreator(eventId);
  if (createdBy === undefined) return { status: 'not_found' };
  return canManageEvent(actor, createdBy)
    ? { status: 'allowed', createdBy }
    : { status: 'forbidden', createdBy };
}
```

Run: `npm test --prefix apps/web -- event-permissions.test.ts`

Expected: PASS.

- [ ] **Step 3: Fetch ownership before mutation and enforce it**

In both PUT and DELETE, authenticate first and call `authorizeEvent` with a loader that selects `created_by` for `params.id`. Map its result exactly:

```ts
const authorization = await authorizeEvent(authUser, params.id, async (eventId) => {
  const { data } = await supabase.from('events').select('created_by').eq('id', eventId).maybeSingle();
  return data ? data.created_by : undefined;
});
if (authorization.status === 'not_found') {
  return NextResponse.json({ error: 'Event not found' }, { status: 404 });
}
if (authorization.status === 'forbidden') {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

Retain the existing calendar update/delete behavior after authorization.

- [ ] **Step 4: Apply the same authorization to calendar synchronization**

The endpoint must fetch `id, created_by` before calendar work and apply the same `authorizeEvent` result mapping. Only an `allowed` result may call `createCalendarEvent` or `syncEventToGoogle`.

Run: `npm test --prefix apps/web -- event-permissions.test.ts`

Expected after implementation: PASS.

- [ ] **Step 5: Run web tests and commit**

Run: `npm test --prefix apps/web`

Expected: all web tests PASS.

```bash
git add apps/web/src/lib/eventPermissions.ts apps/web/src/app/api/events/[id]/route.ts apps/web/src/app/api/mobile/sync-event/route.ts apps/web/tests/unit/event-permissions.test.ts
git commit -m "feat(web): authorize student event creators"
```

### Task 4: Attendance Data Hook and Screen

**Files:**
- Create: `apps/mobile/src/hooks/useEventAttendance.ts`
- Create: `apps/mobile/src/screens/EventAttendanceScreen.tsx`
- Create: `apps/mobile/app/(admin)/events/attendance/[id].tsx`
- Create: `apps/mobile/app/(student)/events/attendance/[id].tsx`
- Modify: `apps/mobile/app/(admin)/events/_layout.tsx`
- Modify: `apps/mobile/app/(student)/events/_layout.tsx`
- Modify: `apps/mobile/src/lib/demo.ts`

**Interfaces:**
- Consumes Task 1 types/helpers and Task 2 RPC.
- Produces `useEventAttendance(eventId, actor)` with `{ students, sections, summary, loading, error, saving, dirty, setStatus, save, refetch }`.
- Produces shared `EventAttendanceScreen({ role }: { role: AppRole })` route body.

- [ ] **Step 1: Add a focused data-shaping test case**

Extend `event-attendance.test.ts` with a test that merges all `role = 'student'` profiles, optional RSVP rows, and RLS-visible attendance rows into `AttendanceRosterStudent[]`. Add and export:

```ts
export function mergeAttendanceRoster(
  profiles: Array<{ id: string; first_name: string; last_name: string; avatar_url?: string }>,
  rsvps: Array<{ user_id: string; status: 'going' | 'maybe' | 'no' }>,
  attendance: Array<{ user_id: string; status: AttendanceStatus }>,
): AttendanceRosterStudent[];
```

Run the focused test and confirm it fails before implementation, then implement it and confirm it passes.

- [ ] **Step 2: Implement the hook**

Fetch in parallel:

```ts
supabase.from('users').select('id, first_name, last_name, avatar_url').eq('role', 'student');
supabase.from('event_rsvps').select('user_id, status').eq('event_id', eventId);
supabase.from('event_attendance').select('user_id, status').eq('event_id', eventId);
```

Keep original and current status maps. `setStatus(userId, status)` updates only local state. `save()` computes `buildAttendanceChanges`, returns early when empty, then:

```ts
const { error } = await supabase.rpc('save_event_attendance', {
  target_event_id: eventId,
  changes: buildAttendanceChanges(original, current),
});
if (error) throw error;
```

On success, replace the original map with a copy of current. On failure, preserve current and expose the error.

- [ ] **Step 3: Build the shared screen with real design tokens**

Use `SectionList`, `TextInput` search, themed summary cards, status buttons, and the shared `Fab`/Paper button patterns. Never import raw hex values. Use `statusGood*`, `statusBad*`, and `statusWarn*` tokens for selected states. The Save button remains docked above the safe area and is disabled when `!dirty || saving`.

Reject unauthorized deep links after loading the event:

```ts
if (!canManageEvent(userId, userRole, event.created_by)) {
  return <ErrorState message="You don't have permission to manage this event's attendance." />;
}
```

- [ ] **Step 4: Register both role-aware routes**

Each wrapper delegates to the shared screen:

```tsx
import { EventAttendanceScreen } from '@/screens/EventAttendanceScreen';
export default function Attendance() { return <EventAttendanceScreen role="student" />; }
```

Use `role="admin"` in the admin wrapper and add `<Stack.Screen name="attendance/[id]" options={{ title: 'Attendance' }} />` to both event layouts.

- [ ] **Step 5: Run mobile tests, lint, and typecheck**

```bash
npm test --prefix apps/mobile
npm run lint --prefix apps/mobile
npx tsc --noEmit --project apps/mobile/tsconfig.json
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit attendance UI/data**

```bash
git add apps/mobile/src/lib/event-attendance.ts apps/mobile/tests/event-attendance.test.ts apps/mobile/src/hooks/useEventAttendance.ts apps/mobile/src/screens/EventAttendanceScreen.tsx 'apps/mobile/app/(admin)/events/attendance/[id].tsx' 'apps/mobile/app/(student)/events/attendance/[id].tsx' 'apps/mobile/app/(admin)/events/_layout.tsx' 'apps/mobile/app/(student)/events/_layout.tsx' apps/mobile/src/lib/demo.ts
git commit -m "feat(mobile): add event attendance workflow"
```

### Task 5: Event Views, Present List, and Creator Actions

**Files:**
- Create: `apps/mobile/src/hooks/useEventViews.ts`
- Modify: `apps/mobile/src/screens/EventDetailScreen.tsx`

**Interfaces:**
- Produces `useEventViews(eventId, userId)` with `{ viewCount, recordView, loadViewers }`.
- Consumes Task 1 `canManageEvent`, Task 2 `event_views`/attendance policies, Task 4 attendance route.

- [ ] **Step 1: Implement idempotent view tracking hook**

The hook loads `event_views(count)` for the event, upserts once per mounted event/user with:

```ts
await supabase.from('event_views').upsert(
  { event_id: eventId, user_id: userId },
  { onConflict: 'event_id,user_id', ignoreDuplicates: true },
);
```

After a successful insert attempt, refresh the aggregate count. Catch tracking errors without surfacing a blocking alert. `loadViewers()` queries `users(id, first_name, last_name, avatar_url)` ordered by `viewed_at desc` and throws query failures to the dialog caller.

- [ ] **Step 2: Add event detail engagement UI**

Add an eye icon plus `<count> seen` next to RSVP engagement. Reuse `UserListDialog`. Opening the dialog sets `users = null`, loads viewers, then shows either names, empty state, or a recoverable alert/error state.

- [ ] **Step 3: Add privacy-safe Present list**

Query only:

```ts
supabase
  .from('event_attendance')
  .select('users(id, first_name, last_name, avatar_url)')
  .eq('event_id', id)
  .eq('status', 'present');
```

Show `Present (N)` when `N > 0`; tapping uses `UserListDialog`. Do not fetch absent/unmarked rows on ordinary event detail.

- [ ] **Step 4: Add creator-aware actions and attendance navigation**

Use live `userRole`, not only the route-group prop:

```ts
const canManage = canManageEvent(userId, userRole ?? role, event.created_by);
```

Show Edit/Delete and `Take Attendance` when `canManage` is true. Preserve admin reminder/chat actions. Navigate to `/(student|admin)/events/attendance/[id]` with the current role group.

- [ ] **Step 5: Verify and commit**

Run mobile tests, lint, and typecheck as in Task 4. Expected: all exit 0.

```bash
git add apps/mobile/src/hooks/useEventViews.ts apps/mobile/src/screens/EventDetailScreen.tsx
git commit -m "feat(mobile): add event viewers and organizer actions"
```

### Task 6: Shared Comment Composer and Compact Post Controls

**Files:**
- Create: `apps/mobile/src/components/ComposerInput.tsx`
- Create: `apps/mobile/src/lib/composer-state.ts`
- Create: `apps/mobile/tests/composer-state.test.ts`
- Modify: `apps/mobile/src/components/ChatInput.tsx`
- Modify: `apps/mobile/src/screens/EventDetailScreen.tsx`
- Modify: `apps/mobile/src/screens/PostDetailScreen.tsx`

**Interfaces:**
- Produces controlled `ComposerInput` with `value`, `onChangeText`, `onSend`, `placeholder`, `sending`, `disabled`, and optional accessibility/focus callbacks.
- Produces `sendDraft(draft, sender)` returning `{ sent, draft, error? }`.

- [ ] **Step 1: Write failing draft-state tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { sendDraft } from '@/lib/composer-state';

describe('sendDraft', () => {
  it('trims and clears only after success', async () => {
    const sender = vi.fn(async () => {});
    await expect(sendDraft('  hello  ', sender)).resolves.toEqual({ sent: true, draft: '' });
    expect(sender).toHaveBeenCalledWith('hello');
  });

  it('preserves the original draft after failure', async () => {
    const error = new Error('offline');
    await expect(sendDraft('hello', async () => { throw error; })).resolves.toEqual({ sent: false, draft: 'hello', error });
  });

  it('does not send whitespace', async () => {
    const sender = vi.fn();
    await expect(sendDraft('   ', sender)).resolves.toEqual({ sent: false, draft: '   ' });
    expect(sender).not.toHaveBeenCalled();
  });
});
```

Run: `npm test --prefix apps/mobile -- composer-state.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement `sendDraft` and `ComposerInput`**

`ComposerInput` must render the exact container/input/button structure now used by `ChatInput`, with `surfaceVariant`, `radius.lg`, `space` tokens, maximum height 100, safe-area padding, a contained send icon, a 2,000-character limit, and a forwarded text-input ref.

Implement `sendDraft` exactly as the tests require, catching the sender error and returning it rather than erasing the draft.

- [ ] **Step 3: Refactor chat without behavior drift**

Keep chat's current optimistic clear and failure announcement in `ChatInput`; replace only its JSX/styles with `ComposerInput`. Verify typing callbacks and refocus behavior remain intact.

- [ ] **Step 4: Replace post and event comment inputs**

Both screens call `sendDraft`. On `{ sent: true }`, set the draft to `''` and refocus. On `{ sent: false, error }`, keep the returned draft and show the existing error alert plus an accessibility announcement. Both role variants use the docked composer.

- [ ] **Step 5: Replace post text actions with icon-only actions**

Use Paper `IconButton` controls with accessibility labels and at least 44-point effective targets:

```tsx
<IconButton
  icon={editing ? 'close' : 'pencil-outline'}
  accessibilityLabel={editing ? 'Cancel editing post' : 'Edit post'}
  onPress={toggleEditing}
/>
<IconButton
  icon="delete-outline"
  iconColor={tokens.statusBadFg}
  accessibilityLabel="Delete post"
  onPress={handleDelete}
/>
```

Keep the inline edit form's text Save/Cancel actions unchanged.

- [ ] **Step 6: Run verification and commit**

Run mobile tests, lint, and typecheck. Expected: all exit 0.

```bash
git add apps/mobile/src/components/ComposerInput.tsx apps/mobile/src/lib/composer-state.ts apps/mobile/tests/composer-state.test.ts apps/mobile/src/components/ChatInput.tsx apps/mobile/src/screens/EventDetailScreen.tsx apps/mobile/src/screens/PostDetailScreen.tsx
git commit -m "feat(mobile): unify comment composers"
```

### Task 7: Uniform Default and Student Creation Regression Coverage

**Files:**
- Create: `packages/database/src/constants.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `apps/mobile/src/screens/NewEventScreen.tsx`
- Modify: `apps/web/src/app/api/events/route.ts`
- Modify: `apps/web/tests/unit/events-create.test.ts`

**Interfaces:**
- Produces one exact default string on mobile and web.
- Consumes Task 2 creator RLS and Task 3 sync authorization.

- [ ] **Step 1: Add a failing web default test**

```ts
it('uses the standard uniform when omitted', async () => {
  const { uniform: _uniform, ...withoutUniform } = validBody;
  const response = await POST(makeCreateRequest(withoutUniform));
  expect(response.status).toBe(200);
  expect(mockState.insertedPayload?.uniform).toBe(
    'Ambo polo with khaki or navy pants/shorts (appropriate length).',
  );
});
```

Run: `npm test --prefix apps/web -- events-create.test.ts`

Expected: FAIL with the old default.

- [ ] **Step 2: Add one shared constant and update both defaults**

Create the shared constant in `packages/database/src/constants.ts`, export it from the package index, and initialize mobile form state with it:

```ts
export const DEFAULT_EVENT_UNIFORM = 'Ambo polo with khaki or navy pants/shorts (appropriate length).';
const [uniform, setUniform] = useState(DEFAULT_EVENT_UNIFORM);
```

Update the web create fallback to the identical value. Preserve intentional clearing on mobile by continuing to send `null` when the edited field is blank.

- [ ] **Step 3: Verify student creation failures are visible**

In `NewEventScreen`, treat RSVP-option insert and calendar-sync failures deliberately:

- event insert failure blocks navigation and retains the form;
- RSVP-option failure reports that the event exists but options were not saved;
- calendar-sync failure reports that the event exists in AmboPortal but calendar sync failed;
- successful creation navigates back once.

Do not claim rollback when the event row already exists.

- [ ] **Step 4: Run web/mobile checks and commit**

```bash
npm test --prefix apps/web -- events-create.test.ts
npm test --prefix apps/mobile
npm run lint --prefix apps/mobile
npx tsc --noEmit --project apps/mobile/tsconfig.json
```

Expected: all commands exit 0.

```bash
git add packages/database/src/constants.ts packages/database/src/index.ts apps/mobile/src/screens/NewEventScreen.tsx apps/web/src/app/api/events/route.ts apps/web/tests/unit/events-create.test.ts
git commit -m "feat: standardize student event creation"
```

### Task 8: Apply and Verify the Production Migration

**Files:**
- Verify: `apps/web/supabase/migrations/20260720_event_views_attendance.sql`

**Interfaces:**
- Makes Task 2 database interfaces available to the deployed app.

- [ ] **Step 1: Re-read and validate the exact migration**

Check destructive operations, locks, function security, policy composition, grants, and rollback implications. Confirm no unrelated data mutation or backfill.

- [ ] **Step 2: Confirm the live target and pre-state**

List accessible Supabase projects and stop unless the exact match is `AmboPortal — lazwwkysaygqkskpbzbd`. List remote migrations and inspect every touched object. If equivalent objects already exist, reconcile instead of blindly reapplying.

- [ ] **Step 3: Apply exactly one migration**

Use the authenticated Supabase migration operation with project ID `lazwwkysaygqkskpbzbd` and migration name `event_views_attendance` using the exact reviewed file contents.

Expected: one successful migration record; no partial application.

- [ ] **Step 4: Run targeted verification**

Verify:

- both tables, columns, PK/unique/check/FK constraints, and indexes;
- RLS enabled and grants limited as designed;
- function signatures, `SECURITY DEFINER`, fixed `search_path`, and execution grants;
- authenticated ordinary student can insert only their own event view;
- ordinary student SELECT returns Present attendance rows but not absence rows;
- event creator/admin can read full attendance and call the save RPC;
- unrelated student cannot call the save RPC;
- student event insert/update/delete and RSVP-option policies are creator-scoped;
- student post INSERT is self-attributed.

- [ ] **Step 5: Run Supabase advisors**

Run security and performance advisors and investigate every new finding caused by this migration. Expected: no unresolved migration-caused security error or material performance warning.

- [ ] **Step 6: Record verification without committing secrets or student data**

Report the migration name, project ID, schema checks, policy tests, advisor results, and any application deployment dependency. Do not add credentials or production row contents to Git.

### Task 9: Full Verification and Release-Build Gate

**Files:**
- Modify only if verification finds a feature-specific defect.

**Interfaces:**
- Validates all earlier tasks as one feature.

- [ ] **Step 1: Run the complete automated/static suite**

```bash
npm test --prefix apps/mobile
npm test --prefix apps/web
npm run lint --prefix apps/mobile
npm run lint --prefix apps/web
npx tsc --noEmit --project apps/mobile/tsconfig.json
npx tsc --noEmit --project apps/web/tsconfig.json
npm run build --prefix apps/web
```

Expected: every command exits 0. Record any pre-existing warning separately; do not hide failures.

- [ ] **Step 2: Review the feature diff and migration boundary**

```bash
git diff main...HEAD --check
git status --short
```

Expected: feature diff is clean; only known user-owned `AGENTS.md`, `.codex/`, and `.superpowers/` changes remain outside feature commits.

- [ ] **Step 3: Build and run iOS Release in the simulator**

Run from `apps/mobile`:

```bash
npx expo run:ios --configuration Release
```

Expected: native build succeeds and AmboPortal launches without Metro.

- [ ] **Step 4: Perform the approved role matrix manually**

Verify with demo-safe or authorized test accounts:

1. event views are unique and viewer dialog names match;
2. admin and student creator can save/clear attendance;
3. unrelated student cannot open attendance management or read absence classifications;
4. Present list is available to ordinary students;
5. grouping is Going, Maybe, No RSVP, Can't Go;
6. student posts/events publish immediately;
7. student creator can edit/delete and calendar-sync only their event;
8. comment drafts clear on success and persist on failure;
9. post actions are icon-only with VoiceOver labels;
10. the uniform default is exact and editable;
11. light/dark appearance remains aligned with AmboPortal tokens.

- [ ] **Step 5: Stop for Skyler's build confirmation**

Do not push. Report the exact checks completed, any unverified live behavior, and ask Skyler to confirm the Release build is good.

- [ ] **Step 6: Push/PR only after confirmation**

After Skyler confirms, push `apollo-07-20-2026`, verify the Vercel preview, open a PR to `main`, and confirm CI is green. Merge, EAS production build, and App Store submission remain separate explicit decisions under the repository release workflow.
