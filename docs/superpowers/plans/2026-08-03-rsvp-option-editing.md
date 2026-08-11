# RSVP Option Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify native RSVP control styling and let event managers safely edit custom RSVP options without losing RSVPs on rename or turning deleted-option RSVPs into No RSVP.

**Architecture:** Extend the event update schema with a backward-compatible stable-ID option shape, then reconcile option rows by ID in the existing authorized API route. The native detail screen will maintain an option draft seeded from `useEventDetail`, confirm destructive removals, submit stable IDs, and refetch after success.

**Tech Stack:** Next.js 14 API routes, Zod 4, Supabase PostgreSQL, React Native 0.83, Expo SDK 55, React Native Paper, Vitest.

## Global Constraints

- Renaming or reordering an option preserves every RSVP attached to it.
- Deleting an option preserves each affected student's `going` RSVP and clears only `rsvp_option_id`.
- No database migration is required; the existing foreign key uses `ON DELETE SET NULL`.
- Existing string-array API clients remain supported.
- Mobile supports at most 10 custom RSVP options, each 1–200 trimmed characters.
- Blank or case-insensitively duplicate labels are rejected.
- Existing event authorization and Maybe/Can't Go explanation rules remain unchanged.
- Do not commit directly to `main` without explicit authorization from Skyler.

---

### Task 1: Stable RSVP option update contract

**Files:**
- Modify: `apps/web/src/lib/validations.ts`
- Create: `apps/web/src/lib/eventRsvpOptions.ts`
- Create: `apps/web/tests/unit/event-rsvp-option-updates.test.ts`

**Interfaces:**
- Produces: `EventRsvpOptionInput = string | { id?: string; label: string }`
- Produces: `buildRsvpOptionMutationPlan(existing, incoming)` returning `{ updates, inserts, deleteIds }` or throwing a validation error.
- Consumes: existing `eventUpdateSchema`.

- [ ] **Step 1: Write failing schema and reconciliation tests**

Test stable objects, legacy strings, trimmed case-insensitive duplicates,
cross-event/unknown IDs, rename-in-place, reordered IDs, new rows, and omitted
IDs:

```ts
expect(eventUpdateSchema.parse({
  rsvp_options: [{ id: OPTION_A, label: "Morning shift" }, { label: "New" }],
}).rsvp_options).toHaveLength(2);

expect(() => buildRsvpOptionMutationPlan(existing, [
  { id: OPTION_A, label: "Bus 1" },
  { label: "bus 1" },
])).toThrow("RSVP option labels must be unique");

expect(buildRsvpOptionMutationPlan(existing, [
  { id: OPTION_A, label: "Renamed" },
])).toEqual({
  updates: [{ id: OPTION_A, label: "Renamed", sort_order: 0 }],
  inserts: [],
  deleteIds: [OPTION_B],
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd apps/web && npm test -- tests/unit/event-rsvp-option-updates.test.ts
```

Expected: failure because `eventRsvpOptions.ts` and the object schema do not yet
exist.

- [ ] **Step 3: Implement the validation union and pure mutation planner**

Use a discriminated-by-type union while preserving legacy strings:

```ts
const editableRsvpOptionSchema = z.object({
  id: z.string().uuid("Invalid RSVP option ID").optional(),
  label: z.string().trim().min(1, "RSVP option cannot be blank")
    .max(200, "RSVP option must be 200 characters or less"),
}).strict();

rsvp_options: z.array(
  z.union([legacyRsvpOptionSchema, editableRsvpOptionSchema]),
).max(50, "An event can have at most 50 RSVP options").optional(),
```

The planner must normalize strings to legacy label matching, preserve object IDs,
assign submitted array indexes as `sort_order`, reject IDs absent from `existing`,
and compute deletions from omitted existing IDs.

- [ ] **Step 4: Run the focused test and verify it passes**

Run the Step 2 command. Expected: all reconciliation tests pass.

### Task 2: Apply the stable option plan in the event update API

**Files:**
- Modify: `apps/web/src/app/api/events/[id]/route.ts`
- Create: `apps/web/tests/unit/events-id-rsvp-options.test.ts`

**Interfaces:**
- Consumes: `buildRsvpOptionMutationPlan(existing, incoming)`.
- Produces: successful PUT response containing `rsvp_options` in saved order.

- [ ] **Step 1: Write failing route tests with a stateful Supabase mock**

Cover:

```ts
expect(optionState.find((option) => option.id === OPTION_A)?.label)
  .toBe("Renamed option");
expect(rsvpState[0]).toMatchObject({
  status: "going",
  rsvp_option_id: null,
});
expect(response.status).toBe(200);
```

Also assert unknown option IDs return 400 before any option mutation and a
database mutation error returns 500 rather than silent success.

- [ ] **Step 2: Run the route test and verify it fails**

Run:

```bash
cd apps/web && npm test -- tests/unit/events-id-rsvp-options.test.ts
```

Expected: rename is treated as delete/add, option errors are ignored, and the
response lacks saved options.

- [ ] **Step 3: Replace label-only diffing with the stable mutation plan**

Load existing rows with an error check, build the plan, then:

```ts
for (const update of plan.updates) {
  const { error } = await supabase
    .from("event_rsvp_options")
    .update({ label: update.label, sort_order: update.sort_order })
    .eq("id", update.id)
    .eq("event_id", params.id);
  if (error) return optionMutationFailure(error);
}
```

Insert new rows, delete omitted IDs, check every result, select the final ordered
rows, and include them as `rsvp_options` in the JSON response. Map planner input
errors to 400 and database failures to 500.

- [ ] **Step 4: Run focused and existing event authorization tests**

Run:

```bash
cd apps/web && npm test -- tests/unit/events-id-rsvp-options.test.ts tests/unit/events-id-authorization.test.ts
```

Expected: both files pass and calendar sync remains skipped for RSVP-only edits.

### Task 3: Native edit form and deletion confirmation

**Files:**
- Modify: `apps/mobile/src/screens/EventDetailScreen.tsx`
- Modify: `apps/mobile/tests/event-detail-dependencies.mock.ts`
- Modify: `apps/mobile/tests/event-detail-screen.test.ts`

**Interfaces:**
- Consumes: `EventRSVPOption[]` and RSVP rows from `useEventDetail`.
- Produces: `EditableRsvpOption = { clientKey: string; id?: string; label: string }`.
- Sends: `{ rsvp_options: Array<{ id?: string; label: string }> }`.

- [ ] **Step 1: Write failing native interaction tests**

Add tests that open edit mode, verify current labels are seeded, rename/add/remove
options, and inspect the PUT body:

```ts
expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).rsvp_options)
  .toEqual([
    { id: OPTION_A, label: "Renamed option" },
    { label: "New option" },
  ]);
```

Assert selected-option deletion displays:

```ts
expect(alertSpy).toHaveBeenCalledWith(
  "Remove RSVP option?",
  expect.stringContaining("remain marked Going"),
  expect.any(Array),
);
```

Also cover no warning for unused options, all options removed, duplicate labels,
and a failed save retaining the edit form and draft.

- [ ] **Step 2: Run the focused native test and verify it fails**

Run:

```bash
cd apps/mobile && npm test -- tests/event-detail-screen.test.ts
```

Expected: no editable RSVP fields or stable option payload exist.

- [ ] **Step 3: Add draft state and synchronize it when edit mode opens**

Add:

```ts
type EditableRsvpOption = {
  clientKey: string;
  id?: string;
  label: string;
};

const beginEditing = () => {
  setEditRsvpOptions(rsvpOptions.map((option) => ({
    clientKey: option.id,
    id: option.id,
    label: option.label,
  })));
  setEditing(true);
};
```

Use deterministic incrementing client keys for new options. Do not overwrite an
active draft when background data refreshes.

- [ ] **Step 4: Render option inputs and controls**

Reuse the new-event editor pattern with accessible labels:

```tsx
<TextInput
  accessibilityLabel={`RSVP option ${index + 1}`}
  value={option.label}
  onChangeText={(label) => updateEditOption(option.clientKey, label)}
/>
<IconButton
  accessibilityLabel={`Remove RSVP option ${index + 1}`}
  icon="close"
  onPress={() => requestRemoveEditOption(option)}
/>
```

Include Add, Move Up, and Move Down controls, disable Add at 10, and make the
submitted order authoritative.

- [ ] **Step 5: Validate, confirm removals, save stable IDs, and refetch**

Before sending, trim labels, reject blanks/duplicates, identify omitted existing
IDs, and count linked RSVP rows. If any removed IDs are selected, show one
confirmation and invoke the actual async save only from its destructive button.
After success call the `refetch` function returned by `useEventDetail`, update
event fields, and exit edit mode. On failure, leave draft and edit mode unchanged.

- [ ] **Step 6: Run the focused native test**

Run the Step 2 command. Expected: all event detail tests pass.

### Task 4: Unified native RSVP control appearance and full verification

**Files:**
- Modify: `apps/mobile/src/screens/EventDetailScreen.tsx`
- Modify: `apps/mobile/tests/event-detail-screen.test.ts`

**Interfaces:**
- Consumes: shared `rsvpChoice` style.
- Produces: identical radius, minimum height, border width, and selected-state
  layout for default and custom RSVP choices.

- [ ] **Step 1: Write a failing style contract test**

Flatten a default and custom control style and assert:

```ts
expect(customStyle.borderRadius).toBe(defaultStyle.borderRadius);
expect(customStyle.minHeight).toBe(defaultStyle.minHeight);
expect(customStyle.borderWidth).toBe(defaultStyle.borderWidth);
expect(customIcon.props.size).toBe(defaultIcon.props.size);
```

- [ ] **Step 2: Run the style test and verify it fails**

Run:

```bash
cd apps/mobile && npm test -- tests/event-detail-screen.test.ts
```

Expected: current `radius.lg`/`space.sm` custom chip values differ from the
default `radius.md`/`space.md` controls.

- [ ] **Step 3: Share the visual foundation**

Use the same `radius.md`, `minHeight`, `borderWidth: 1.5`, horizontal padding,
icon size 18, and pressed opacity for both controls. Keep their semantic colors,
wrapping, and selected content.

- [ ] **Step 4: Run all focused checks**

Run:

```bash
cd apps/web && npm test -- tests/unit/event-rsvp-option-updates.test.ts tests/unit/events-id-rsvp-options.test.ts tests/unit/events-id-authorization.test.ts
cd apps/mobile && npm test -- tests/event-detail-screen.test.ts tests/new-event-screen.test.ts
npm run typecheck --workspace=@ambo/web
npm run typecheck --workspace=@ambo/mobile
npm run lint --workspace=@ambo/web
npm run lint --workspace=@ambo/mobile
```

Expected: all commands pass.

- [ ] **Step 5: Run broader regression tests**

Run:

```bash
cd apps/web && npm test
cd apps/mobile && npm test
```

Expected: all suites pass.

- [ ] **Step 6: Build and inspect the iOS Release app**

Run:

```bash
cd apps/mobile && npx expo run:ios --configuration Release
```

Expected: the Release build installs and opens in the simulator. Verify edit
seeding, rename/add/delete, selected-option warning, default fallback, and matched
control shapes. Do not push until Skyler confirms the Release build is good.
