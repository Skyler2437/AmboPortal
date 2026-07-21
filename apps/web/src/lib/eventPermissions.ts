export interface EventActor {
  userId: string;
  role: string;
}

export type EventAuthorization =
  | { status: "allowed"; createdBy: string | null }
  | { status: "forbidden"; createdBy: string | null }
  | { status: "not_found" };

export function canManageEvent(
  actor: EventActor,
  createdBy: string | null,
): boolean {
  return (
    actor.role === "admin" ||
    actor.role === "superadmin" ||
    (actor.role === "student" && actor.userId === createdBy)
  );
}

export async function authorizeEvent(
  actor: EventActor,
  eventId: string,
  loadCreator: (eventId: string) => Promise<string | null | undefined>,
): Promise<EventAuthorization> {
  const createdBy = await loadCreator(eventId);
  if (createdBy === undefined) return { status: "not_found" };

  return canManageEvent(actor, createdBy)
    ? { status: "allowed", createdBy }
    : { status: "forbidden", createdBy };
}
