export type ExistingRsvpOption = {
  id: string;
  label: string;
  sort_order: number;
};

export type EventRsvpOptionInput =
  | string
  | {
      id?: string;
      label: string;
    };

export type RsvpOptionMutationPlan = {
  updates: Array<{
    id: string;
    label: string;
    sort_order: number;
  }>;
  inserts: Array<{
    label: string;
    sort_order: number;
  }>;
  deleteIds: string[];
};

export class RsvpOptionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RsvpOptionValidationError";
  }
}

export function buildRsvpOptionMutationPlan(
  existing: ExistingRsvpOption[],
  incoming: EventRsvpOptionInput[],
): RsvpOptionMutationPlan {
  const existingById = new Map(existing.map((option) => [option.id, option]));
  const existingByLabel = new Map(existing.map((option) => [option.label, option]));
  const retainedIds = new Set<string>();
  const seenLabels = new Set<string>();
  const updates: RsvpOptionMutationPlan["updates"] = [];
  const inserts: RsvpOptionMutationPlan["inserts"] = [];

  incoming.forEach((rawOption, sortOrder) => {
    const label = (
      typeof rawOption === "string" ? rawOption : rawOption.label
    ).trim();
    const normalizedLabel = label.toLocaleLowerCase();
    if (seenLabels.has(normalizedLabel)) {
      throw new RsvpOptionValidationError("RSVP option labels must be unique");
    }
    seenLabels.add(normalizedLabel);

    if (typeof rawOption === "string") {
      const existingOption = existingByLabel.get(label);
      if (existingOption) {
        retainedIds.add(existingOption.id);
        updates.push({
          id: existingOption.id,
          label,
          sort_order: sortOrder,
        });
      } else {
        inserts.push({ label, sort_order: sortOrder });
      }
      return;
    }

    if (!rawOption.id) {
      inserts.push({ label, sort_order: sortOrder });
      return;
    }

    const existingOption = existingById.get(rawOption.id);
    if (!existingOption) {
      throw new RsvpOptionValidationError(
        "RSVP option does not belong to this event",
      );
    }
    if (retainedIds.has(rawOption.id)) {
      throw new RsvpOptionValidationError("RSVP option ID cannot be repeated");
    }
    retainedIds.add(rawOption.id);
    updates.push({
      id: rawOption.id,
      label,
      sort_order: sortOrder,
    });
  });

  return {
    updates,
    inserts,
    deleteIds: existing
      .filter((option) => !retainedIds.has(option.id))
      .map((option) => option.id),
  };
}
