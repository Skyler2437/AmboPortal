import type { SupabaseClient } from "@supabase/supabase-js";

export interface EventActor {
  userId: string;
  role: string;
}

export type EventAuthorization =
  | { status: "allowed"; createdBy: string | null }
  | { status: "forbidden"; createdBy: string | null }
  | { status: "not_found" };

export type StoredEventAuthorization =
  | EventAuthorization
  | { status: "database_error" };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidEventId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

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

export async function authorizeStoredEvent(
  actor: EventActor,
  eventId: string,
  supabase: SupabaseClient,
): Promise<StoredEventAuthorization> {
  const { data, error } = await supabase
    .from("events")
    .select("created_by")
    .eq("id", eventId)
    .maybeSingle();

  if (error) {
    console.error("[eventPermissions] Event ownership lookup failed", {
      code: error.code,
      message: error.message,
    });
    return { status: "database_error" };
  }

  return authorizeEvent(actor, eventId, async () =>
    data ? (data.created_by as string | null) : undefined,
  );
}
