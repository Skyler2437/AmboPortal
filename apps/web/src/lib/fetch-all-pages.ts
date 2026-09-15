/**
 * Fetch every page of a paginated API route (lib/pagination.ts response
 * shape). The admin tables filter, search, and count client-side, so they
 * need the complete set — a single capped page silently hides older rows.
 */
export async function fetchAllPages<T>(
  baseUrl: string,
  pageSize = 100
): Promise<T[]> {
  const sep = baseUrl.includes("?") ? "&" : "?";
  const first = await fetch(`${baseUrl}${sep}limit=${pageSize}&page=1`);
  if (!first.ok) {
    throw new Error(`Request failed: ${first.status}`);
  }
  const json = await first.json();
  // Legacy flat-array responses have no pagination envelope
  if (!json.pagination) return json.data ?? json;

  const totalPages = json.pagination.totalPages ?? 1;
  if (totalPages > 100) throw new Error("Too many pages to load completely");
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) =>
      fetch(`${baseUrl}${sep}limit=${pageSize}&page=${i + 2}`).then((res) => {
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        return res.json();
      })
    )
  );

  return [
    ...(json.data ?? []),
    ...rest.flatMap((page: { data?: T[] }) => page.data ?? []),
  ];
}
