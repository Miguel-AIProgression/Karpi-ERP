import { supabase } from '../client'

export interface PrijslijstOverviewRow {
  nr: string
  naam: string
  geldig_vanaf: string | null
  actief: boolean
  aantal_regels: number
  klanten: { debiteur_nr: number; naam: string }[]
}

export interface PrijslijstDetailRow {
  nr: string
  naam: string
  geldig_vanaf: string | null
  actief: boolean
}

export interface PrijslijstRegelRow {
  id: number
  artikelnr: string
  omschrijving: string | null
  omschrijving_2: string | null
  prijs: number
  gewicht: number | null
  ean_code: string | null
  producten: { gewicht_kg: number | null } | null
}

/** Paginate all rows from a Supabase table query */
async function paginateAll<T>(
  queryFn: (offset: number, limit: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = []
  let offset = 0
  while (true) {
    const { data, error } = await queryFn(offset, offset + pageSize - 1)
    if (error) throw error
    all.push(...((data ?? []) as T[]))
    if (!data || data.length < pageSize) break
    offset += pageSize
  }
  return all
}

/** Fetch all prijslijsten with linked klanten count */
export async function fetchPrijslijsten(): Promise<PrijslijstOverviewRow[]> {
  // Get all headers
  const { data: headers, error: hErr } = await supabase
    .from('prijslijst_headers')
    .select('nr, naam, geldig_vanaf, actief')
    .order('nr')

  if (hErr) throw hErr

  // Get ALL klanten with prijslijst_nr (paginated past 1000-row limit)
  const debiteuren = await paginateAll<{ debiteur_nr: number; naam: string; prijslijst_nr: string }>(
    (from, to) =>
      supabase
        .from('debiteuren')
        .select('debiteur_nr, naam, prijslijst_nr')
        .not('prijslijst_nr', 'is', null)
        .range(from, to),
  )

  // Build klant map
  const klantMap: Record<string, { debiteur_nr: number; naam: string }[]> = {}
  for (const d of debiteuren) {
    const pnr = d.prijslijst_nr
    if (!klantMap[pnr]) klantMap[pnr] = []
    klantMap[pnr].push({ debiteur_nr: d.debiteur_nr, naam: d.naam })
  }

  // Get regel counts per prijslijst (only count, no data transfer)
  const countMap: Record<string, number> = {}
  const batchSize = 10
  const headerList = headers ?? []
  for (let i = 0; i < headerList.length; i += batchSize) {
    const batch = headerList.slice(i, i + batchSize)
    const results = await Promise.all(
      batch.map((h) =>
        supabase
          .from('prijslijst_regels')
          .select('*', { count: 'exact', head: true })
          .eq('prijslijst_nr', h.nr as string)
          .then(({ count, error }) => {
            if (error) throw error
            return { nr: h.nr as string, count: count ?? 0 }
          }),
      ),
    )
    for (const r of results) {
      countMap[r.nr] = r.count
    }
  }

  return headerList.map((h) => ({
    nr: h.nr as string,
    naam: h.naam as string,
    geldig_vanaf: h.geldig_vanaf as string | null,
    actief: h.actief as boolean,
    aantal_regels: countMap[h.nr as string] ?? 0,
    klanten: klantMap[h.nr as string] ?? [],
  }))
}

/** Fetch single prijslijst header */
export async function fetchPrijslijstDetail(nr: string): Promise<PrijslijstDetailRow | null> {
  const { data, error } = await supabase
    .from('prijslijst_headers')
    .select('nr, naam, geldig_vanaf, actief')
    .eq('nr', nr)
    .single()

  if (error) throw error
  return data as PrijslijstDetailRow | null
}

/** Fetch all regels for a prijslijst (paginated past 1000-row limit) */
export async function fetchPrijslijstRegels(prijslijstNr: string): Promise<PrijslijstRegelRow[]> {
  const allRows: PrijslijstRegelRow[] = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('prijslijst_regels')
      .select('id, artikelnr, omschrijving, omschrijving_2, prijs, gewicht, ean_code, producten(gewicht_kg)')
      .eq('prijslijst_nr', prijslijstNr)
      .order('artikelnr')
      .range(offset, offset + pageSize - 1)

    if (error) throw error
    // Supabase infereert `producten` als array (geen 1:1-hint op PK),
    // runtime is het een enkel object omdat artikelnr PK is op producten.
    allRows.push(...((data ?? []) as unknown as PrijslijstRegelRow[]))
    if (!data || data.length < pageSize) break
    offset += pageSize
  }
  return allRows
}

/** Fetch klanten linked to a prijslijst */
export async function fetchPrijslijstKlanten(prijslijstNr: string) {
  const { data, error } = await supabase
    .from('debiteuren')
    .select('debiteur_nr, naam, status, plaats')
    .eq('prijslijst_nr', prijslijstNr)
    .order('naam')

  if (error) throw error
  return (data ?? []) as { debiteur_nr: number; naam: string; status: string; plaats: string | null }[]
}

/** Update prijs for a single regel */
export async function updatePrijslijstRegel(id: number, prijs: number) {
  const { error } = await supabase
    .from('prijslijst_regels')
    .update({ prijs })
    .eq('id', id)

  if (error) throw error
}

/** Bulk update prijzen for multiple regels */
export async function bulkUpdatePrijzen(updates: { id: number; prijs: number }[]) {
  // Supabase doesn't support bulk update natively, so batch individual updates
  const errors: string[] = []
  for (const u of updates) {
    const { error } = await supabase
      .from('prijslijst_regels')
      .update({ prijs: u.prijs })
      .eq('id', u.id)
    if (error) errors.push(`${u.id}: ${error.message}`)
  }
  if (errors.length > 0) throw new Error(`Fouten bij ${errors.length} updates: ${errors.join(', ')}`)
}
