import type { SupabaseClient } from "@supabase/supabase-js";

type ServiceTotals = { total_hours: number; total_credits: number };

/** Fetch all approved records for one page of students, even beyond the API row cap. */
export async function getTeamServiceTotals(supabase: SupabaseClient, studentIds: string[]) {
  const totals = new Map<string, ServiceTotals>(studentIds.map((id) => [id, { total_hours: 0, total_credits: 0 }]));
  if (!studentIds.length) return totals;

  let offset = 0;
  let expectedCount: number | undefined;
  do {
    const { data, error, count } = await supabase.from("submissions")
      .select("user_id, hours, credits", { count: "exact" })
      .in("user_id", studentIds)
      .eq("status", "Approved")
      .order("id")
      .range(offset, offset + 499);

    if (error || !data || count == null || (expectedCount !== undefined && count !== expectedCount)) {
      throw new Error("Could not load complete student totals");
    }
    expectedCount = count;
    if (!data.length && offset < count) throw new Error("Student totals were incomplete");

    for (const submission of data) {
      const total = totals.get(submission.user_id);
      if (!total) continue;
      const hours = Number(submission.hours ?? 0);
      const credits = Number(submission.credits ?? 0);
      if (!Number.isFinite(hours) || !Number.isFinite(credits)) throw new Error("Invalid student total");
      total.total_hours += hours;
      total.total_credits += credits;
    }
    offset += data.length;
  } while (offset < expectedCount);

  totals.forEach((total) => {
    total.total_hours = Number(total.total_hours.toFixed(10));
    total.total_credits = Number(total.total_credits.toFixed(10));
  });
  return totals;
}
