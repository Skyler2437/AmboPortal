# iOS Unread-Message App Icon Badges

**Date:** July 15, 2026  
**Status:** Approved for planning

## Goal

Make the AmboPortal iOS Home Screen badge behave like Apple Messages: the red app-icon badge shows the total number of unread chat messages across all conversations. Reading a conversation removes that conversation's unread messages from the total. Merely launching or foregrounding the app does not clear unread messages.

## Scope

This change covers the native mobile app's iOS app-icon badge and the web notification sender used by Expo push notifications. It does not change which notifications users receive, the existing notification-preference controls, or the existing in-app Chat tab badge. The Chat tab continues to count unread conversations; the Home Screen icon counts individual unread messages.

The web chat will also persist conversation reads to `chat_participants.last_read_at`. It currently records them only in browser `localStorage`; persisting the same read timestamp is necessary so reading on the website reconciles the iPhone badge correctly.

Pending submissions, posts, events, and comments do not add to the app-icon badge. Those notification types also must not clear an existing unread-chat badge.

## Source of Truth

The existing `chat_participants.last_read_at` value remains the read-state source of truth. A message is unread for a user when all of the following are true:

- The user is a participant in the message's chat group.
- The message was sent by another user.
- The message's `created_at` is later than that participant's `last_read_at`.
- The message's `created_at` is later than that participant's `deleted_at`, when the conversation was soft-deleted. A newer message resurfaces the conversation and begins counting again.

A PostgreSQL function will calculate the exact unread-message total from `chat_participants` and `chat_messages`. This avoids a denormalized counter that could drift after retries, multi-device reads, or partial failures. The existing indexes on `chat_participants.user_id` and `chat_messages(group_id, created_at)` support the query.

The function must enforce that ordinary authenticated callers can obtain only their own count. The server-side service-role client may obtain a count for a notification recipient. The function returns a nonnegative integer and treats a missing `last_read_at` as no messages having been read.

## Notification Data Flow

1. A new row is committed to `chat_messages`.
2. The existing Supabase database webhook invokes the web notification dispatcher.
3. For each recipient other than the sender, the dispatcher calculates that recipient's complete unread-message total after the new row exists.
4. The dispatcher includes that total in the Expo message's iOS `badge` field.
5. APNs replaces the icon badge with the supplied absolute value. It does not increment a device-local value.

Using an absolute server-derived total makes repeated webhook delivery idempotent and keeps multiple devices for the same user consistent.

The shared push payload type will accept an optional badge. Chat-message pushes provide it. Other notification types omit it so they preserve the existing icon count.

## Mobile Synchronization

The mobile app will use the same database function to reconcile the icon badge:

- After authentication and on initial protected-layout mount.
- Whenever the app returns to the foreground.
- After a new chat message arrives through Realtime.
- After the current user's `chat_participants.last_read_at` changes, including when a conversation is opened.

The app applies the returned total with `Notifications.setBadgeCountAsync(total)`. A total of zero intentionally clears the badge. The existing unconditional `setBadgeCountAsync(0)` calls on launch and foreground will be removed.

The notification permission request will explicitly include iOS badge permission. The foreground notification handler will continue allowing an incoming notification's badge value to be applied.

If reconciliation fails because the device is offline or the database request fails, the app leaves the existing badge unchanged. It must not clear the badge on an error. A later foreground, Realtime event, or app relaunch retries reconciliation.

## Existing In-App Indicators

`useBadgeCounts` will continue deriving the Chat tab badge from the set of unread group IDs. It will additionally expose the authoritative individual unread-message total for the Home Screen badge synchronization path. Optimistically marking a group read may hide the Chat tab indicator immediately, but the app-icon count is reconciled from persisted `last_read_at` after the read update completes.

Admin pending-submission tab badges remain unchanged and are not included in the iOS app-icon count.

Selecting a conversation in the web chat will call an authenticated mark-read endpoint after applying its existing optimistic local indicator. The endpoint verifies group membership before updating only the caller's participant row. Failure leaves the server timestamp unchanged and can be retried the next time the conversation is selected.

## Database Migration

A timestamped SQL migration will:

- Create the unread-count function.
- Use `SECURITY DEFINER` only if required for the service-role recipient lookup, with a fixed `search_path` and an explicit authorization check for authenticated callers.
- Grant execution only to the roles that need it.
- Preserve existing tables and read timestamps; no data backfill is necessary because the count is derived live.

Migrations in this project are applied manually through the Supabase SQL Editor. The application code and migration must ship together; until the migration is applied, the sender must fail safely by omitting the badge rather than blocking notification delivery.

## Testing

Automated tests will be written before production code and will verify:

- A push payload with an unread total serializes the exact Expo `badge` value.
- A zero badge is retained rather than treated as absent.
- A push payload without a badge omits the field and preserves existing behavior for non-chat notifications.
- Failed unread-count lookup does not prevent delivery of the chat notification.
- Mobile reconciliation applies a successful count, including zero, and does not clear the current badge after a failed lookup.
- The web mark-read endpoint rejects nonparticipants and updates only the authenticated participant.

Static verification will include web tests, web typechecking, and mobile lint/typechecking as supported by the repository scripts.

Push behavior must be tested on a physical iPhone using a Release build:

1. Send several messages to one conversation while AmboPortal is backgrounded; the icon badge equals the number of unread messages.
2. Send messages to multiple conversations; the badge equals their combined unread-message total.
3. Open one conversation; its messages are removed from the badge while other unread messages remain.
4. Foreground the app without opening unread conversations; the badge remains accurate.
5. Read all conversations; the badge clears.
6. Send a non-chat notification; it does not increment or clear the chat badge.

Per the repository workflow, these mobile changes must not be pushed until Skyler confirms the physical-device Release build is good.

## Rollout and Failure Handling

Apply the database migration before deploying application code that depends on the function. The sender logs unread-count failures and still sends the notification without a badge. The mobile client retains the last known icon count when reconciliation fails. These fallbacks preserve working push notifications during a partial rollout or transient outage.

No feature branch, commit, push, EAS build, or App Store submission is included unless Skyler explicitly requests the corresponding workflow step.
