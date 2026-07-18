# iOS Unread-Message Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the authoritative total of unread chat messages on the AmboPortal iOS app icon and reconcile it whenever messages are read.

**Architecture:** A protected PostgreSQL RPC derives the count from `chat_participants.last_read_at` and `chat_messages`. The web push dispatcher sends that absolute count in Expo's `badge` field, while a focused mobile helper applies the same RPC result on launch, foreground, realtime inserts, and completed read updates.

**Tech Stack:** PostgreSQL/Supabase RPC, Next.js 14 route handlers, TypeScript, Vitest, Expo Notifications SDK 55, React Native/Expo Router.

## Global Constraints

- The Home Screen badge counts individual unread messages; the Chat tab continues counting unread conversations.
- Messages sent by the current user never count as unread.
- Non-chat notifications neither increment nor clear the app-icon badge.
- Failed reconciliation leaves the existing device badge unchanged and never blocks notification delivery.
- Preserve the user's existing edits in `PushNotificationsProvider.tsx`.
- Do not create a branch, commit, push, build, or submit without Skyler's explicit request.
- Physical push verification uses an iPhone Release build, never the simulator or Metro.

---

### Task 1: Authoritative unread-count RPC and shared client

**Files:**
- Create: `apps/web/supabase/migrations/20260715_unread_message_badge_count.sql`
- Create: `packages/database/src/unread-messages.ts`
- Modify: `packages/database/package.json`
- Test: `apps/web/tests/unit/unread-messages.test.ts`

**Interfaces:**
- Produces: `getUnreadMessageCount(client: SupabaseClient, userId: string): Promise<number | null>`.
- Produces: RPC `public.get_unread_chat_message_count(target_user_id uuid) returns bigint`.

- [ ] Write failing Vitest cases proving numeric/string RPC values normalize to a nonnegative integer and errors return `null`.
- [ ] Run `npm test -- --run tests/unit/unread-messages.test.ts` from `apps/web`; expect failure because the module does not exist.
- [ ] Add the SQL function with a fixed `search_path`, caller authorization (`auth.uid()` or `service_role`), sender exclusion, and `last_read_at` comparison; grant only `authenticated` and `service_role` execution.
- [ ] Implement the shared RPC wrapper and export it as `@ambo/database/unread-messages`.
- [ ] Re-run the focused test; expect all cases to pass.

### Task 2: Expo payload badge support

**Files:**
- Modify: `apps/web/src/lib/notifications.ts`
- Test: `apps/web/tests/unit/notifications.test.ts`

**Interfaces:**
- Extends: `PushPayload` with `badge?: number`.
- Produces: `buildExpoPushMessage(token: string, payload: PushPayload)` for deterministic serialization.

- [ ] Write failing tests proving positive and zero badges are serialized and an omitted badge is not added.
- [ ] Run the focused notification test; expect failure because badge support/builder is absent.
- [ ] Extract the existing message-object construction into `buildExpoPushMessage`, conditionally spreading `badge` when `payload.badge !== undefined`.
- [ ] Use the builder in `sendExpoNotifications` and re-run the focused test; expect all cases to pass.

### Task 3: Chat webhook supplies authoritative badge totals

**Files:**
- Modify: `apps/web/src/app/api/webhooks/notifications/route.ts`
- Test: `apps/web/tests/unit/notification-webhook.test.ts`

**Interfaces:**
- Consumes: `getUnreadMessageCount` and `PushPayload.badge`.

- [ ] Write failing tests showing a successful RPC count is passed with each recipient's chat notification and an RPC failure sends the notification without a badge.
- [ ] Run the focused webhook test; expect failure because the handler does not perform the count lookup.
- [ ] In `handleChatMessage`, calculate each recipient's count after insertion and include it only when non-null; retain `Promise.allSettled` so one recipient cannot block another.
- [ ] Re-run the focused webhook test; expect both success and fallback cases to pass.

### Task 4: Persist web conversation reads

**Files:**
- Create: `apps/web/src/app/api/chat/groups/[id]/read/route.ts`
- Modify: `apps/web/src/components/chat/ChatLayout.tsx`
- Test: `apps/web/tests/unit/chat-read-route.test.ts`

**Interfaces:**
- Produces: authenticated `POST /api/chat/groups/:id/read` returning `{ ok: true }`.

- [ ] Write failing route tests for unauthenticated, nonparticipant, successful update, and database-error responses.
- [ ] Run the focused route test; expect failure because the route is absent.
- [ ] Implement membership verification with the admin client, then update only the caller's `chat_participants` row with one ISO timestamp.
- [ ] Update `selectGroup` to retain its optimistic localStorage behavior and fire the authenticated mark-read request without blocking navigation.
- [ ] Re-run the route tests; expect all cases to pass.

### Task 5: Mobile badge reconciliation

**Files:**
- Create: `apps/mobile/src/lib/app-badge.ts`
- Modify: `apps/mobile/src/providers/PushNotificationsProvider.tsx`
- Modify: `apps/mobile/src/hooks/useChatThreadMeta.ts`
- Modify: `apps/mobile/src/hooks/useBadgeCounts.ts`
- Test: `apps/web/tests/unit/app-badge-policy.test.ts`

**Interfaces:**
- Produces: `syncUnreadMessageBadge(userId: string): Promise<boolean>`.
- Produces: pure `badgeCountToApply(result: number | null): number | null` for policy testing.

- [ ] Write failing policy tests showing zero and positive totals are applied while `null` remains `null` and therefore does not clear the badge.
- [ ] Run the focused policy test; expect failure because the module is absent.
- [ ] Implement `app-badge.ts` using the shared RPC wrapper and `Notifications.setBadgeCountAsync`; skip non-iOS platforms and leave the badge unchanged on `null`.
- [ ] Replace unconditional launch/foreground clearing in the provider with authenticated reconciliation while preserving the current token-rotation edits; explicitly request `allowBadge` on iOS.
- [ ] After `last_read_at` updates successfully in `useChatThreadMeta`, reconcile the icon count.
- [ ] After relevant realtime chat inserts in `useBadgeCounts`, reconcile the icon count so users with chat push alerts disabled still receive an accurate foreground badge.
- [ ] Re-run the focused policy test; expect all cases to pass.

### Task 6: Full verification and handoff

**Files:**
- Modify only files required to resolve failures introduced by Tasks 1-5.

- [ ] Run `git diff --check`; expect no whitespace errors.
- [ ] Run `npm test` from `apps/web`; expect all Vitest tests to pass.
- [ ] Run `npx tsc --noEmit` from `apps/web`; expect no TypeScript errors.
- [ ] Run `npx tsc --noEmit` from `apps/mobile`; expect no TypeScript errors.
- [ ] Run `npm run lint` from `apps/mobile`; expect no lint errors introduced by this change.
- [ ] Review `git diff` to confirm existing token-rotation changes remain intact and unrelated user files are untouched.
- [ ] Hand off the unapplied SQL migration and the physical-device Release test checklist; do not push until Skyler confirms the build is good.
