// helpers/fake-supabase.ts — queue-based fake-Supabase voor magazijn-contracttests.
// Gedeeld door magazijn-pickbaarheid.contract.test.ts en
// pickbaarheid-productie-only.test.ts. Registreert toegepaste .eq-filters en
// past ze toe op array-data (PostgREST-simulatie). Embedded-resource-filters
// (kolomnaam met punt, bv. 'zendingen.status') worden NIET client-side
// toegepast — PostgREST filtert die server-side binnen de embed; de fixture
// moet zelf al gefilterde rijen aanleveren.

export type SupabaseResponse = {
  data: unknown
  error: { code?: string; message?: string } | null
}

const responses: Record<string, SupabaseResponse[]> = {}

/** Verzamelt per tabel de toegepaste `.eq(column, value)`-filters. */
export const appliedEqFilters: Record<string, Array<[string, unknown]>> = {}

export function queueResponse(table: string, response: SupabaseResponse) {
  if (!responses[table]) responses[table] = []
  responses[table].push(response)
}

export function resetQueues() {
  for (const k of Object.keys(responses)) delete responses[k]
  for (const k of Object.keys(appliedEqFilters)) delete appliedEqFilters[k]
}

function buildChain(table: string) {
  const eqFilters: Array<[string, unknown]> = []

  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      eqFilters.push([column, value])
      if (!appliedEqFilters[table]) appliedEqFilters[table] = []
      appliedEqFilters[table].push([column, value])
      return chain
    },
    neq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    update: () => chain,
    insert: () => chain,
    then: (
      resolve: (value: SupabaseResponse) => void,
      reject: (reason: unknown) => void
    ) => {
      const next = responses[table]?.shift()
      if (!next) {
        reject(new Error(`Geen response voor tabel "${table}" in test-queue`))
        return
      }
      const platteFilters = eqFilters.filter(([col]) => !col.includes('.'))
      if (next.error === null && Array.isArray(next.data) && platteFilters.length > 0) {
        const filtered = (next.data as Array<Record<string, unknown>>).filter((row) =>
          platteFilters.every(([col, val]) => row[col] === val)
        )
        resolve({ data: filtered, error: null })
        return
      }
      resolve(next)
    },
  }
  return chain
}

export const fakeSupabase = {
  from: (table: string) => buildChain(table),
  rpc: () => Promise.resolve({ data: 0, error: null }),
}
