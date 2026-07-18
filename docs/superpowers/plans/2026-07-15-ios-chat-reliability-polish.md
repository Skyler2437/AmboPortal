# iOS Chat Reliability and Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development task-by-task. The repository workflow keeps this work in the current working tree; do not create a branch, worktree, commit, or push unless Skyler explicitly requests it.

**Goal:** Make the iOS chat update live, reconcile sends reliably, preserve unread badges correctly, scroll smoothly, and present accessible professional message and inbox interactions.

**Architecture:** Extract deterministic chat state decisions into small pure TypeScript helpers covered by Vitest, then consume those helpers from the existing shared admin/student screens. Split Supabase database-change and typing Presence channels so ephemeral typing failures cannot stop message delivery; reconcile successful sends from the insert response and use Realtime only for cross-client delivery. Keep the existing New Chat and roster picker unchanged.

**Tech Stack:** Expo SDK 55, React Native 0.83, React 19, TypeScript, Supabase JS 2.98, React Native Paper, Reanimated 4, React Native Gesture Handler 2.30, Vitest 4.

## Global Constraints

- Do not modify `NewChatScreen.tsx`, `MemberPickerGrid.tsx`, or the recipient-selection experience; Skyler explicitly excluded review item #7 because the roster stays below 50.
- Do not redesign the visual composer; internal send/typing behavior and nonvisual accessibility labels may change to fix reliability.
- Preserve all existing uncommitted unread-badge work, especially `useChatThreadMeta.ts`, `useBadgeCounts.ts`, and `app-badge.ts`.
- Do not create a branch, worktree, commit, stage, push, migration, or remote database mutation.
- Admin and student routes must continue sharing the same chat screens and hooks.
- Every behavioral production change must follow RED → GREEN with a focused Vitest test where it can be expressed as pure logic.
- Realtime interruptions must never leave a successful outgoing message permanently in `sending`, and reconnect must reconcile missed incoming messages.
- Presence activity must not emit one network event per keystroke.
- Respect iOS Reduce Motion and expose every gesture action through VoiceOver-accessible actions.

---

### Task 1: Mobile Chat Test Harness and Deterministic State Helpers

**Files:**
- Modify: `apps/mobile/package.json`
- Modify mechanically: `package-lock.json`
- Create: `apps/mobile/vitest.config.ts`
- Create: `apps/mobile/src/lib/chat-message-state.ts`
- Create: `apps/mobile/src/lib/chat-thread-state.ts`
- Create: `apps/mobile/tests/chat-message-state.test.ts`
- Create: `apps/mobile/tests/chat-thread-state.test.ts`

**Interfaces:**
- Produces `nextTypingPresence(isTyping, hasText)` returning `{ isTyping, event: true | false | null }`.
- Produces `reconcileServerMessage(messages, serverMessage, optimisticId?)` returning a deduplicated array whose server row has `status: 'sent'`.
- Produces `mergeRealtimeMessage(messages, serverMessage, fallbackUser)` for immediate incoming delivery and exact-ID deduplication.
- Produces `shouldMarkThreadRead({ isFocused, appState, isNearBottom, latestMessageId, lastMarkedMessageId })`.
- Produces `getMessageGroupPresentation(messages, index, currentUserId)` with group position and sender/avatar/meta/status visibility.

- [ ] Add `test: "vitest run"` and mobile-local Vitest 4 dev dependency/config.
- [ ] Write failing tests proving repeated nonempty typing activity emits `true` once, empty/idle emits `false` once, and repeated empty activity emits nothing.
- [ ] Run `npm test --workspace apps/mobile -- chat-message-state.test.ts` and verify RED because helpers do not exist.
- [ ] Implement the minimal typing and message reconciliation helpers.
- [ ] Run the focused test and verify GREEN.
- [ ] Write failing tests for read gating: false while unfocused/backgrounded/away from bottom/already marked, true only when active, focused, near bottom, and a new latest ID exists.
- [ ] Write failing tests for grouping: same sender within five minutes groups; sender/date/gap breaks the cluster; avatar/name/meta/status visibility matches boundaries.
- [ ] Implement minimal thread-state helpers and verify the focused tests pass.

### Task 2: Realtime Delivery, Typing Throttle, and Send Reconciliation

**Files:**
- Modify: `apps/mobile/src/hooks/useChatMessages.ts`
- Modify: `apps/mobile/src/components/ChatInput.tsx`
- Modify: `apps/mobile/src/screens/ChatThreadScreen.tsx`
- Test: `apps/mobile/tests/chat-message-state.test.ts`

**Interfaces:**
- `useChatMessages(groupId: string, currentUserId: string)` returns existing fields plus `connectionStatus` and `connectionError`.
- `ChatInput` reports typing state changes, but its visuals remain unchanged.

- [ ] Extend failing state-helper tests to prove a successful insert response replaces an optimistic row without any Realtime callback and that a duplicate Realtime event does not duplicate the row.
- [ ] Verify RED.
- [ ] Split the hook into `chat-messages:<groupId>` for Postgres changes/likes and `chat-presence:<groupId>` for typing Presence, using the current user ID as Presence key.
- [ ] Replace per-keystroke `track()` with a transition: send `typing: true` once, reset only a local three-second timer on further activity, and send `typing: false` on idle, empty text, send, blur/unmount.
- [ ] Subscribe with a status callback. On `CHANNEL_ERROR` or `TIMED_OUT`, surface reconnecting state and let realtime-js perform its built-in rejoin; recreate with bounded backoff only after terminal `CLOSED`. Perform silent reconciliation after every `SUBSCRIBED` state.
- [ ] Append incoming Postgres payloads immediately using cached sender metadata, then enrich a missing profile asynchronously without withholding the bubble.
- [ ] Change insert to `.insert(...).select('id, group_id, sender_id, content, created_at').single()` and reconcile the optimistic row directly from that response. Realtime remains a secondary deduplicated path.
- [ ] Keep the composer available for consecutive messages; catch rejected sends, retain the failed bubble, and announce failure through `AccessibilityInfo` without an unhandled rejection.
- [ ] Verify focused tests GREEN.

### Task 3: Correct Read State, Error Recovery, and Stable Scrolling

**Files:**
- Modify: `apps/mobile/src/screens/ChatThreadScreen.tsx`
- Modify: `apps/mobile/src/hooks/useChatMessages.ts`
- Test: `apps/mobile/tests/chat-thread-state.test.ts`

**Interfaces:**
- Consumes `shouldMarkThreadRead` and the hook's connection status.

- [ ] Add/verify failing read-gating tests for a new message arriving below the viewport and for reaching the bottom afterward.
- [ ] Remove unconditional `markGroupRead` on mount and `markRead()` on every `messages.length` change.
- [ ] Persist read state only when the screen is focused, the app is active, the user is near the bottom, and the newest loaded message has not already been marked. Trigger the same decision when focus returns, app becomes active, or scrolling reaches the bottom.
- [ ] Consume `error`/`refetch`: initial fetch failures render `ErrorState` with retry instead of “No messages yet”; an interrupted live connection with cached messages renders a compact “Reconnecting…” status and retains the thread.
- [ ] Add a numeric unseen-message badge to the scroll-to-latest control while the user is away from the bottom.
- [ ] Replace competing delayed and content-size scroll calls with one content-size-driven pending-scroll path. Use `maintainVisibleContentPosition` to preserve position when prepending older messages.
- [ ] Load older history automatically near the top with a synchronous in-flight guard; keep only a compact header spinner.
- [ ] Use `scrollEventThrottle={16}`, interactive iOS keyboard dismissal, and a minimum 44×44 scroll-to-latest hit target.
- [ ] Verify read-state tests GREEN.

### Task 4: Message Grouping, Failure Contrast, Reactions, and Motion

**Files:**
- Modify: `apps/mobile/src/components/MessageBubble.tsx`
- Modify: `apps/mobile/src/screens/ChatThreadScreen.tsx`
- Test: `apps/mobile/tests/chat-thread-state.test.ts`

**Interfaces:**
- Consumes `getMessageGroupPresentation`.

- [ ] Verify grouping tests fail against the pre-change presentation contract.
- [ ] Group consecutive messages from the same sender within five minutes, merging adjacent corners and tightening internal spacing.
- [ ] Show incoming name at the first bubble and avatar at the last bubble in a cluster. Show timestamp only at a cluster boundary; show `Sending…`/failure when applicable and `Sent` only for the latest outgoing sent message.
- [ ] Make failed outgoing content use the semantic error foreground instead of white on pale red.
- [ ] Replace the custom double-tap recognizer with a long-press action sheet/menu offering Like/Unlike and Copy, plus Retry for a failed outgoing message. Add haptic confirmation.
- [ ] Make each message a single useful VoiceOver element with named `accessibilityActions` for Like/Unlike, Copy, and Retry; do not hide nested actions behind an accessible parent.
- [ ] Animate typing dots and reaction feedback only when Reduce Motion is disabled; retain a clear static state otherwise.
- [ ] Use AA-capable secondary text colors for chat timestamps/status copy.
- [ ] Verify focused grouping tests GREEN and run mobile typecheck/lint.

### Task 5: Native Swipe Quality and Inbox Identity

**Files:**
- Modify: `apps/mobile/package.json`
- Modify mechanically: `package-lock.json`
- Modify: `apps/mobile/app/_layout.tsx`
- Modify: `apps/mobile/src/components/SwipeableChatRow.tsx`
- Modify: `apps/mobile/src/screens/ChatListScreen.tsx`

**Interfaces:**
- `SwipeableChatRow` reports opening/closing and consumes the parent-owned open-row ID so the list can keep a single row open.

- [ ] Add Expo-compatible `react-native-gesture-handler@~2.30.0` and wrap the app root with `GestureHandlerRootView`.
- [ ] Replace JS-thread `PanResponder` with `ReanimatedSwipeable`, disable overshoot, and provide native-feeling friction/thresholds.
- [ ] Keep only one row open, close it when another opens or the list scrolls, and provide haptic action feedback.
- [ ] Hide closed offscreen buttons from the accessibility tree and add button roles. Add row-level VoiceOver actions for Star/Unstar and Delete.
- [ ] Expand the chat-row accessibility summary to include title, preview, relative time, unread state, starred state, and available actions.
- [ ] Render composite avatars for multi-person groups and prefix previews with `You:` or the sender’s first name where appropriate.
- [ ] Use higher-contrast swipe action fills and ensure list bottom padding keeps the final row clear of the existing FAB.
- [ ] Run mobile typecheck/lint.

### Task 6: Full Verification and Review

**Files:**
- Review all files changed by Tasks 1–5.

- [ ] Run `npm test --workspace apps/mobile`.
- [ ] Run `npx tsc --noEmit -p apps/mobile/tsconfig.json`.
- [ ] Run `npm run lint --workspace apps/mobile`.
- [ ] Run existing web unit tests covering unread badges because thread read timing changed: `npm test --workspace apps/web -- tests/unit/app-badge-policy.test.ts tests/unit/chat-read-route.test.ts tests/unit/unread-messages.test.ts`.
- [ ] Inspect `git diff --check` and `git diff --stat`; verify New Chat/member-picker files are untouched and existing badge changes remain intact.
- [ ] Dispatch a read-only final code review focused on Realtime lifecycle races, optimistic deduplication, read/badge correctness, gesture accessibility, and scope compliance.
- [ ] Resolve every Critical/Important review issue, rerun the covering tests, and re-review.
- [ ] Report that physical-device verification remains pending until Xcode 27 can be installed; do not claim device behavior was tested locally.
