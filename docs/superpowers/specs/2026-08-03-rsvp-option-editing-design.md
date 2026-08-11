# RSVP Option Editing and Visual Consistency Design

**Date:** 2026-08-03
**Status:** Approved in conversation

## Goal

Make custom RSVP choices visually consistent with the default Going, Maybe, and
Can't Go choices, and let authorized event managers add, rename, reorder, and
delete custom RSVP options while editing an existing event.

The central data requirement is:

- Renaming or reordering an option preserves every RSVP attached to it.
- Deleting an option preserves each affected student's `going` RSVP, but clears
  the selected custom option.

## Non-goals

- Changing the meaning of the default Going, Maybe, or Can't Go statuses.
- Changing the 50–500 character explanation requirement for Maybe and Can't Go.
- Adding a private-disclosure toggle.
- Adding new roles or changing who may edit an event.
- Migrating existing RSVP data.

## User Experience

### Consistent RSVP controls

Default and custom RSVP choices will use the same visual foundation:

- equal height and horizontal padding;
- the same corner radius and border weight;
- the same selected and pressed states;
- consistent icon sizing and label alignment.

Status colors and icons can remain distinct so Going, Maybe, and Can't Go retain
their meaning. The change is to shape and spacing, not to the status semantics.

### Editing options

The event edit form will include an RSVP Options section based on the existing
new-event form:

- Existing options load in their saved order.
- A manager can edit an option label in place.
- A manager can add a new option.
- A manager can remove an option.
- Blank labels are not saved.
- Duplicate labels are rejected after trimming and case normalization.
- The mobile editor retains the existing limit of 10 custom options.
- If all custom options are removed, the event returns to the default Going,
  Maybe, and Can't Go controls.

Removing an option that has one or more student selections requires confirmation.
The confirmation explains that the students will remain marked Going, but their
specific option will be cleared. Removing an unused option does not require the
extra warning.

If saving fails, the edit form stays open with the user's changes intact and
shows an actionable error. The screen refreshes its event details after a
successful save so the displayed controls reflect the server result.

## API Contract

The mobile edit screen will send custom options with stable identities:

```json
{
  "rsvp_options": [
    { "id": "existing-option-uuid", "label": "Renamed option" },
    { "label": "New option" }
  ]
}
```

- An object with an `id` updates that existing option.
- An object without an `id` creates a new option.
- An existing option omitted from the submitted array is deleted.
- Array order becomes `sort_order`.

The update endpoint will continue accepting the existing string-array shape for
backward compatibility with web or older clients. In the legacy shape, matching
labels continue to preserve their existing records. The stable object shape is
the authoritative contract for rename-safe editing.

The endpoint validates that every submitted ID belongs to the event being edited.
An unknown ID or an ID belonging to another event fails the request rather than
modifying another event's options.

## Persistence Behavior

For the stable object payload, the event update route will:

1. Authorize the existing admin, superadmin, or event-creator editing rules.
2. Trim and validate labels, option count, uniqueness, and ID shape.
3. Load the event's current options.
4. Reject any supplied ID that is not one of those current options.
5. Update existing option labels and `sort_order` in place.
6. Insert new options in the submitted positions.
7. Delete current options omitted from the payload.
8. Return or refetch the resulting ordered options.

Updating a row in place retains its ID, so linked RSVP rows remain attached after
a rename or reorder. The existing foreign key on
`event_rsvps.rsvp_option_id` uses `ON DELETE SET NULL`; deleting an option
therefore clears only `rsvp_option_id`. The RSVP row and its `going` status remain
unchanged.

No database migration is required because the current schema already supports
the intended deletion behavior.

## Deletion Warning Data

The mobile detail query already has the event RSVP roster and its selected option
IDs. The edit screen can count selections for each option locally. If an option
with a positive count is removed, the screen shows the destructive confirmation
before completing the save.

If several selected options are removed at once, one confirmation summarizes the
total affected students and names the removed options when space permits.

## Failure Handling

- Validation errors are shown before sending when possible.
- Server validation and authorization errors are surfaced in the edit form.
- A failed option mutation must not be presented as a successful event save.
- After any server-side failure, the client keeps the draft and can refetch the
  current event state before a retry if needed.
- The endpoint checks each option mutation result instead of silently ignoring a
  database error.

## Testing

### Mobile tests

- Default and custom RSVP controls share the intended shape and sizing.
- Opening edit mode seeds all current option IDs and labels.
- Adding, renaming, reordering, and removing options creates the expected stable
  payload.
- Removing an option with selections shows the warning.
- Removing an unused option does not show the extra warning.
- Removing all custom options restores the default controls after save.
- Save failures keep edit mode and the draft values intact.

### API tests

- Renaming an option updates the same database ID.
- Reordering options preserves IDs and updates `sort_order`.
- Adding an option inserts a new row.
- Deleting an option removes the option while leaving affected RSVP rows as
  `going` with `rsvp_option_id = null`.
- Unknown and cross-event option IDs are rejected.
- Duplicate or blank labels are rejected.
- The legacy string-array payload remains supported.
- Authorization rules remain unchanged.

### Verification

Run focused mobile and API unit tests, then mobile typecheck and lint. Because the
change touches the native app, install and inspect an iOS Release build before
any push. A physical-device Release build can follow when the device is available.
