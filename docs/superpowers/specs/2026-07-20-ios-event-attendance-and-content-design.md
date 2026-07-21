# iOS Event Attendance and Content Improvements — Design

**Date:** July 20, 2026

**Status:** Approved design; awaiting written-spec review

**Primary scope:** Native iOS app, with supporting Supabase and web API changes

## Goal

Improve event accountability and everyday content creation in the AmboPortal iOS app. Members should be able to see who opened an event, authorized organizers should be able to record attendance, comment entry should match the more reliable chat composer, post management should be visually compact, new events should begin with the standard uniform, and students should be able to publish posts and events without an approval queue.

The finished experience must use AmboPortal's existing theme tokens, React Native Paper components, navigation patterns, spacing, typography, and accessibility conventions. The approved browser mockups define hierarchy and behavior, not a separate visual system.

## Confirmed Product Decisions

- An event view is recorded when an authenticated user opens the event detail screen. Merely seeing an event in the list does not count.
- Event views behave like post views: one permanent view per event/user pair, an eye icon with a count, and a viewer-name dialog available to authenticated users.
- The attendance roster contains every account whose current role is `student`.
- Attendance statuses are `present`, `absent`, and `excused_absent`. A student with no attendance row is `unmarked`; unmarked is neutral and must never be interpreted as absent.
- Admins, superadmins, and the student who created the event can record or change attendance.
- All students can see the names of students marked Present. Only admins, superadmins, and that event's creator can see Absent, Excused Absent, and Unmarked details.
- Attendance roster order is Going, Maybe, No RSVP, then Can't Go. Students are alphabetized by last name and first name within each group.
- Student-created posts and events publish immediately without an approval queue.
- A student can edit and delete an event they created. Admin and superadmin moderation access remains unchanged.
- The new-event form preloads this editable value exactly: `Ambo polo with khaki or navy pants/shorts (appropriate length).`
- Opened-post Edit and Delete controls use icons only. They retain accessible labels and full-size touch targets.
- Event and post comment composers share the chat composer's rounded input, contained send button, keyboard behavior, safe-area spacing, focus behavior, and accessibility treatment.

## Existing Architecture and Required Adjustments

The mobile app already has shared admin/student event and post screens:

- `apps/mobile/src/screens/EventDetailScreen.tsx`
- `apps/mobile/src/screens/EventsListScreen.tsx`
- `apps/mobile/src/screens/NewEventScreen.tsx`
- `apps/mobile/src/screens/PostDetailScreen.tsx`
- `apps/mobile/src/screens/PostsFeedScreen.tsx`

Student routes for creating events and posts already exist, and both list screens already display their create buttons. A local migration also intends to allow student event inserts. This work therefore verifies and completes the existing path instead of adding a second creation flow.

Mobile reads and writes most engagement data through the authenticated Supabase client with RLS enforced. Existing event edits, deletes, and calendar synchronization use bearer-authenticated web API routes. This design preserves those boundaries:

- Event views use direct Supabase access, matching post views.
- Attendance reads use direct Supabase access; attendance mutations use one authenticated database function so a multi-row save is atomic.
- Event edit, delete, and Google Calendar synchronization continue through their existing web API routes, with authorization widened only for the event's student creator.

## Data Model

One timestamped migration adds the following structures.

### `event_views`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key, generated |
| `event_id` | UUID | Required FK to `events`, cascade delete |
| `user_id` | UUID | Required FK to `users`, cascade delete |
| `viewed_at` | TIMESTAMPTZ | Defaults to current time |

The table has a unique constraint on `(event_id, user_id)` and indexes on both foreign keys. Reopening an event does not increase its count or replace the original view timestamp.

RLS and grants:

- Authenticated users can select viewer rows.
- Authenticated users can insert only a row whose `user_id = auth.uid()`.
- Clients cannot update or delete views.

### `event_attendance`

| Column | Type | Notes |
|---|---|---|
| `event_id` | UUID | FK to `events`, cascade delete |
| `user_id` | UUID | FK to `users`, cascade delete |
| `status` | TEXT | Check constraint: `present`, `absent`, `excused_absent` |
| `recorded_by` | UUID | FK to `users`; most recent recorder |
| `updated_at` | TIMESTAMPTZ | Most recent saved change |

The primary key is `(event_id, user_id)`. An unmarked student has no row.

Authenticated reads are protected by RLS:

- Rows with `status = 'present'` are visible to authenticated members.
- All statuses are visible when the caller is an admin/superadmin or the event's creator.
- No direct table mutation grants are exposed to the mobile client.

### Atomic attendance function

An authenticated function such as `save_event_attendance(event_id, changes)` accepts the changed student/status pairs for one event. It:

1. Resolves the caller from `auth.uid()`.
2. verifies the caller is an admin/superadmin or the event's creator;
3. validates every target currently has role `student`;
4. validates status values and rejects duplicate student IDs;
5. upserts Present, Absent, and Excused Absent rows with the caller as `recorded_by`;
6. deletes rows whose requested status is `null`, returning them to Unmarked; and
7. commits all changes together or none of them.

If implemented as `SECURITY DEFINER`, the function must fix `search_path`, qualify object names, grant execution only to `authenticated`, and contain the authorization checks above before any write.

## Event View Experience

When the event detail screen successfully resolves an event and the current user, it performs a best-effort upsert into `event_views` with duplicate conflicts ignored. View recording never blocks rendering and does not show an error alert if the network is unavailable.

The event detail engagement row adds an eye icon and `<count> seen`. Tapping it opens the existing `UserListDialog` pattern, populated by `event_views → users` and ordered newest first. Loading, empty, and query-failure states follow the current post-viewer dialog behavior.

The event fetch includes the aggregate view count. After the current user's first successful view insert, the displayed count updates without double-counting repeat opens.

## Attendance Experience

### Authorized organizer

Admins, superadmins, and the student event creator see a `Take Attendance` button on event detail. It opens a dedicated role-aware attendance route for that event.

The attendance screen includes:

- Present, Absent, Excused, and Unmarked summary counts;
- search by student first or last name;
- section ordering of Going, Maybe, No RSVP, and Can't Go;
- alphabetical order within each section;
- a four-choice row control: Present, Absent, Excused, Clear; and
- a sticky `Save Attendance` button enabled only when local changes exist.

`Clear` removes the saved row and restores Unmarked. RSVP and attendance remain independent: changing attendance does not change a student's RSVP, and changing an RSVP does not overwrite attendance.

The screen preserves local selections while saving. A successful atomic save updates the baseline and summary counts. A failed save leaves every unsaved selection in place, shows a clear retry message, and does not claim that any subset saved.

If another authorized user changes attendance while the screen is open, saving uses the organizer's complete set of changed rows. Unchanged rows are not rewritten. Pull-to-refresh or reopening the screen obtains the latest server state.

### Ordinary student

Students who did not create the event do not see the attendance-management button or full roster. When at least one person is marked Present, event detail shows a `Present (N)` affordance. Tapping it opens a list of Present names only.

The client does not request or render Absent, Excused Absent, or Unmarked classifications for an ordinary student. Database RLS independently enforces the same boundary.

## Student Event Ownership and Publishing

Student post creation continues using the existing direct Supabase path and publishes immediately. Implementation verifies the production `posts` and post-attachment policies with an authenticated student session: a student may insert only a post attributed to their own user ID, while existing owner/admin moderation rules remain intact. If the verified production policy does not enforce that contract, the reviewed migration adds or tightens the policy before the mobile build ships.

Student event creation continues using the shared `NewEventScreen` and publishes immediately. Implementation verifies that the production RLS policy allows authenticated users with role `student`, `admin`, or `superadmin` to insert an event with themselves as `created_by`. RSVP-option inserts follow the same creator permission.

The mobile sync-event endpoint is widened from admin-only to either:

- admin/superadmin; or
- the authenticated creator of the specific event ID.

This prevents a student from triggering synchronization for someone else's event while allowing their own newly published event to reach the existing Google Calendar flow.

The event PUT and DELETE endpoints use the same authorization rule. Student event detail displays Edit and Delete actions only when `event.created_by` matches the current user. Admin/superadmin controls and moderation behavior remain available.

Database update/delete policies are aligned with the API rule: admin/superadmin or the event creator. The API still performs its own check because it uses the service-role client and bypasses RLS.

## Uniform Default

The mobile new-event form initializes its Uniform field with:

`Ambo polo with khaki or navy pants/shorts (appropriate length).`

The value is ordinary editable form state. A creator can change it or intentionally clear it before publishing. Existing events are not backfilled or modified. The web event-creation fallback is updated to the same wording so new events do not receive two different defaults depending on client.

## Comment Composer

The current chat input becomes a reusable composer or delegates its visual/input behavior to a reusable base component. Chat remains behaviorally unchanged.

Post and event comments use that shared base with an `Add a comment...` placeholder. Required behavior:

- rounded `surfaceVariant` multiline input;
- contained circular send button;
- dynamic height capped at the chat input's existing maximum;
- keyboard avoidance and bottom safe-area padding;
- keyboard remains available for consecutive comments after a successful send;
- send is disabled for empty/whitespace-only text or while saving;
- comment text clears only after a successful save; and
- a failed save preserves the draft and announces/shows a retryable error.

Both admin and student event-detail variants use the docked composer. This removes the current role-based difference where the student event composer is inline at the end of the scroll view.

## Post Management Controls

On an opened post, the current text buttons become icon-only pencil and trash controls in the approved compact action placement. The icons:

- appear only when the existing `canModify` ownership/moderation rule allows the action;
- expose `Edit post`, `Cancel editing`, and `Delete post` accessibility labels as appropriate;
- retain at least a 44-by-44-point effective touch target;
- preserve the current destructive confirmation before deletion; and
- do not change the inline edit form or Save/Cancel buttons inside edit mode.

This change applies to post-level actions only. Existing comment edit/delete icons remain unchanged.

## Error Handling and Security

- Event view writes are best-effort and idempotent.
- Attendance saves are atomic and authorized in the database, not only hidden in the UI.
- API routes using the service-role client verify bearer/cookie authentication, current database role, event existence, and creator ownership before mutation or calendar synchronization.
- Unauthorized attendance, event update/delete, or sync attempts return a non-success response and make no change.
- Viewer and Present-name dialogs show recoverable loading/error states without breaking event detail.
- No real student names or records are added to source-controlled fixtures, screenshots, or demo data for this work.

## Rollout Order

1. Add automated tests for pure permission, grouping, view-count, attendance-delta, and composer-state behavior.
2. Add and review the Supabase migration.
3. Apply the migration to the verified AmboPortal production project `lazwwkysaygqkskpbzbd`, one migration at a time, following `docs/supabase-migration-runbook.md`.
4. Run targeted database verification plus Supabase security and performance advisors.
5. Deploy the web API authorization changes before distributing a mobile build that depends on them.
6. Verify the Vercel preview and CI after the feature branch is pushed and the PR is opened.
7. Test the iOS app through a Release simulator build. Do not use Metro/dev-client testing for acceptance.
8. Do not push the mobile changes until Skyler confirms the Release build is good.
9. Merge through the normal repository workflow. EAS production build and App Store submission require separate explicit approval.

The migration must precede the mobile build because the new client queries `event_views`, `event_attendance`, and the attendance save function. If view recording encounters a transient deployment mismatch, it fails silently; attendance displays a clear unavailable/retry state and never fabricates saved results.

## Verification and Acceptance Criteria

### Automated

- Event view insertion is unique per event/user and repeated opens do not inflate the count.
- Event viewer lists include views created from the mobile app.
- Attendance management authorization accepts admin, superadmin, and the matching student creator and rejects other students/applicants.
- Attendance visibility exposes Present rows to authenticated students but hides Absent and Excused Absent rows from unauthorized students.
- A mixed attendance save either applies every changed row or applies none.
- Clear removes an attendance row and returns that student to Unmarked.
- Roster grouping is Going, Maybe, No RSVP, Can't Go, with deterministic last-name/first-name sorting inside each group.
- Search filters the full student roster without changing saved statuses.
- A student may update/delete only their own event; admin/superadmin moderation remains available.
- A student may trigger calendar sync only for an event they created.
- Comment drafts clear on success and remain on failure.
- Post Edit/Delete icon visibility follows existing ownership and role rules.
- The default uniform string matches exactly.

### Static and build checks

- Web lint, typecheck, unit tests, and production build pass.
- Mobile lint, typecheck, unit tests, and production checks pass using repository scripts.
- The migration passes targeted schema/policy checks plus Supabase security and performance advisors.

### Release-build acceptance

In an iOS Release simulator build, verify with admin and student accounts:

1. Opening an event records one viewer and the eye dialog shows that person.
2. Reopening the event does not increment the unique-view count.
3. An admin can set, clear, and revise attendance across all four RSVP sections.
4. The student event creator can manage attendance and edit/delete their event.
5. Another student cannot access the attendance-management route or hidden absence details.
6. An ordinary student can open the Present list and sees only Present names.
7. Student-created posts and events appear immediately.
8. A student-created event reaches the existing calendar synchronization flow.
9. Event and post comments use the rounded composer, stay focused after success, and retain a failed draft.
10. Opened posts show icon-only Edit/Delete actions for authorized users.
11. A new event begins with the exact uniform default and accepts edits or intentional clearing.

## Non-Goals

- Attendance notes, arrival/departure timestamps, service-hour generation, CSV export, or historical change audit logs.
- Automatically marking Can't Go or non-responders absent.
- Student self-check-in, QR codes, geofencing, or kiosk mode.
- An approval queue for student-created posts or events.
- Notifications for event views or attendance changes.
- View tracking from the event list; only opening event detail counts.
- Web attendance-management UI in this release.
- Backfilling event views, attendance, or uniform values for existing events.

## Success Criteria

The feature is ready when the permission rules are enforced independently by the database/API, authorized organizers can save a complete roster without partial writes, ordinary students can see Present names without receiving absence classifications, event views match post-view behavior, all approved UI changes work in an iOS Release build, and the full automated/static verification suite passes.
