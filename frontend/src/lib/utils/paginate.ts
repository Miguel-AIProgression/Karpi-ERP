/**
 * Haalt ALLE rijen op voorbij de PostgREST 1000-rij-cap, maar zonder per pagina
 * een sequentiële round-trip te betalen: pagina's worden per batch van
 * `concurrency` parallel opgehaald. Stopt zodra een pagina niet meer vol is
 * (rijen zijn aaneengesloten dankzij een stabiele .order() in de query, dus de
 * eerste niet-volle pagina is de laatste — kan niet onderpagineren).
 *
 * Vervangt het `while(true) { await ...range() }`-patroon dat lineair trager
 * werd naarmate de dataset groeide.
 *
 * @param buildPage  bouwt één pagina-query voor [from, to] inclusief; geeft het
 *                   PostgREST-resultaat terug ({ data, error }).
 */
export async function fetchAllPaginated<T>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
  concurrency = 4,
): Promise<T[]> {
  const all: T[] = []
  let base = 0
  for (;;) {
    const batch = await Promise.all(
      Array.from({ length: concurrency }, (_, i) => {
        const from = base + i * pageSize
        return buildPage(from, from + pageSize - 1)
      }),
    )
    let done = false
    for (const { data, error } of batch) {
      if (error) throw error
      const rows = (data ?? []) as T[]
      all.push(...rows)
      if (rows.length < pageSize) done = true
    }
    if (done) break
    base += concurrency * pageSize
  }
  return all
}
