import { describe, expect, it } from "vitest";
import {
  RsvpOptionValidationError,
  buildRsvpOptionMutationPlan,
} from "@/lib/eventRsvpOptions";
import { eventUpdateSchema } from "@/lib/validations";

const OPTION_A = "550e8400-e29b-41d4-a716-446655440001";
const OPTION_B = "550e8400-e29b-41d4-a716-446655440002";
const UNKNOWN_OPTION = "550e8400-e29b-41d4-a716-446655440099";

const existing = [
  { id: OPTION_A, label: "Morning shift", sort_order: 0 },
  { id: OPTION_B, label: "Afternoon shift", sort_order: 1 },
];

describe("event RSVP option update contract", () => {
  it("accepts stable option objects and legacy strings", () => {
    expect(eventUpdateSchema.parse({
      rsvp_options: [
        { id: OPTION_A, label: "Renamed option" },
        { label: "New option" },
      ],
    }).rsvp_options).toEqual([
      { id: OPTION_A, label: "Renamed option" },
      { label: "New option" },
    ]);

    expect(eventUpdateSchema.parse({
      rsvp_options: ["Morning shift", "Afternoon shift"],
    }).rsvp_options).toEqual(["Morning shift", "Afternoon shift"]);
  });

  it("rejects malformed stable option objects", () => {
    expect(() => eventUpdateSchema.parse({
      rsvp_options: [{ id: "not-a-uuid", label: "Morning shift" }],
    })).toThrow("Invalid RSVP option ID");

    expect(() => eventUpdateSchema.parse({
      rsvp_options: [{ id: OPTION_A, label: "Morning shift", event_id: "other" }],
    })).toThrow();
  });

  it("renames and reorders existing options without replacing their IDs", () => {
    expect(buildRsvpOptionMutationPlan(existing, [
      { id: OPTION_B, label: "Later shift" },
      { id: OPTION_A, label: "Early shift" },
    ])).toEqual({
      updates: [
        { id: OPTION_B, label: "Later shift", sort_order: 0 },
        { id: OPTION_A, label: "Early shift", sort_order: 1 },
      ],
      inserts: [],
      deleteIds: [],
    });
  });

  it("inserts new options and deletes omitted options", () => {
    expect(buildRsvpOptionMutationPlan(existing, [
      { id: OPTION_A, label: "Morning shift" },
      { label: "Evening shift" },
    ])).toEqual({
      updates: [
        { id: OPTION_A, label: "Morning shift", sort_order: 0 },
      ],
      inserts: [
        { label: "Evening shift", sort_order: 1 },
      ],
      deleteIds: [OPTION_B],
    });
  });

  it("preserves matching IDs for the legacy string payload", () => {
    expect(buildRsvpOptionMutationPlan(existing, [
      "Afternoon shift",
      "New shift",
    ])).toEqual({
      updates: [
        { id: OPTION_B, label: "Afternoon shift", sort_order: 0 },
      ],
      inserts: [
        { label: "New shift", sort_order: 1 },
      ],
      deleteIds: [OPTION_A],
    });
  });

  it("rejects unknown IDs before creating a mutation plan", () => {
    expect(() => buildRsvpOptionMutationPlan(existing, [
      { id: UNKNOWN_OPTION, label: "Other event option" },
    ])).toThrowError(new RsvpOptionValidationError(
      "RSVP option does not belong to this event",
    ));
  });

  it("rejects repeated IDs and case-insensitive duplicate labels", () => {
    expect(() => buildRsvpOptionMutationPlan(existing, [
      { id: OPTION_A, label: "Bus 1" },
      { id: OPTION_B, label: " bus 1 " },
    ])).toThrow("RSVP option labels must be unique");

    expect(() => buildRsvpOptionMutationPlan(existing, [
      { id: OPTION_A, label: "Bus 1" },
      { id: OPTION_A, label: "Bus 2" },
    ])).toThrow("RSVP option ID cannot be repeated");
  });
});
