/** School calendar date, independent of browser or server timezone. */
export function schoolServiceDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export function emptySubmissionForm() {
  return { service_type: "", service_date: schoolServiceDate(), hours: "", tour_credits: "0", notes: "" };
}

/** A successful HTTP response alone does not prove an insert happened (e.g. login redirects). */
export async function confirmSubmissionResponse(res: Response): Promise<void> {
  if (res.redirected || res.status === 401) {
    throw new Error("Your session expired. Please sign in again before submitting. Your entries have been kept.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : "Your hours could not be saved. Please try again.");
  }
  if (data?.ok !== true || typeof data?.id !== "string" || !data.id.trim()) {
    throw new Error("The server did not confirm your submission. Please check your history before trying again. Your entries have been kept.");
  }
}
