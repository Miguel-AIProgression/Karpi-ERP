import { supabase } from '../client'
import { applyProductSearch, filterProductsWordBoundary } from '@/lib/utils/sanitize'

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
  producten:
    | { gewicht_kg: number | null; kwaliteiten: { gewicht_per_m2_kg: number | null } | null }
    | null
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

export interface CreatePrijslijstInput {
  nr: string
  naam: string
  geldig_vanaf: string | null
}

/** Maak nieuwe prijslijst-header aan. Faalt op duplicate nr. */
export async function createPrijslijst(input: CreatePrijslijstInput): Promise<PrijslijstDetailRow> {
  const { data, error } = await supabase
    .from('prijslijst_headers')
    .insert({
      nr: input.nr,
      naam: input.naam,
      geldig_vanaf: input.geldig_vanaf,
      actief: true,
    })
    .select('nr, naam, geldig_vanaf, actief')
    .single()

  if (error) throw error
  return data as PrijslijstDetailRow
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
      .select('id, artikelnr, omschrijving, omschrijving_2, prijs, gewicht, ean_code, producten(gewicht_kg, kwaliteiten(gewicht_per_m2_kg))')
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

export interface KoppelbaarProduct {
  artikelnr: string
  omschrijving: string
  karpi_code: string | null
  zoeksleutel: string | null
  ean_code: string | null
  verkoopprijs: number | null
  gewicht_kg: number | null
  /**
   * Density (kg/m²) uit `kwaliteiten.gewicht_per_m2_kg`. Voor rol/maatwerk-producten
   * waar `producten.gewicht_kg` NULL is fungeert dit als gewicht-fallback in de
   * prijslijst-regel. Mig 181 maakt `kwaliteiten` de bron-van-waarheid voor density.
   */
  gewicht_per_m2_kwaliteit: number | null
  kwaliteit_code: string | null
  kleur_code: string | null
  product_type: string | null
}

/** Producten die nog NIET in de gegeven prijslijst zitten — server-side gezocht met multi-term filter. */
export async function fetchKoppelbareProductenVoorPrijslijst(
  prijslijstNr: string,
  search: string,
): Promise<KoppelbaarProduct[]> {
  // 1. Verzamel artikelnrs die al in deze prijslijst zitten (paginated voor 1000+)
  const inLijst = new Set<string>()
  const pageSize = 1000
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('prijslijst_regels')
      .select('artikelnr')
      .eq('prijslijst_nr', prijslijstNr)
      .range(from, from + pageSize - 1)
    if (error) throw error
    for (const r of data ?? []) {
      const a = (r as { artikelnr: string }).artikelnr
      if (a) inLijst.add(a)
    }
    if (!data || data.length < pageSize) break
    from += pageSize
  }

  // 2. Zoek actieve producten — server-side filter, max 500 om response klein te houden.
  //    Join op kwaliteiten voor density-fallback bij rol/maatwerk-producten.
  const cols =
    'artikelnr, omschrijving, karpi_code, zoeksleutel, ean_code, verkoopprijs, gewicht_kg, kwaliteit_code, kleur_code, product_type, kwaliteiten(gewicht_per_m2_kg)'
  let query = supabase
    .from('producten')
    .select(cols)
    .eq('actief', true)
    .order('artikelnr')
    .limit(500)

  if (search.trim()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = applyProductSearch(query as any, search) as typeof query
  }

  const { data, error } = await query
  if (error) throw error
  const rows = (data ?? []).map((row) => {
    const r = row as Record<string, unknown>
    const kw = r.kwaliteiten as { gewicht_per_m2_kg: number | null } | null
    return {
      artikelnr: r.artikelnr as string,
      omschrijving: (r.omschrijving as string) ?? '',
      karpi_code: (r.karpi_code as string | null) ?? null,
      zoeksleutel: (r.zoeksleutel as string | null) ?? null,
      ean_code: (r.ean_code as string | null) ?? null,
      verkoopprijs: (r.verkoopprijs as number | null) ?? null,
      gewicht_kg: (r.gewicht_kg as number | null) ?? null,
      gewicht_per_m2_kwaliteit: kw?.gewicht_per_m2_kg ?? null,
      kwaliteit_code: (r.kwaliteit_code as string | null) ?? null,
      kleur_code: (r.kleur_code as string | null) ?? null,
      product_type: (r.product_type as string | null) ?? null,
    } as KoppelbaarProduct
  })

  // 3. Word-boundary filter (voorkomt dat "16" matcht in "160") + verwijder al-gekoppelde
  const filtered = search.trim() ? filterProductsWordBoundary(rows, search) : rows
  return filtered.filter((p) => !inLijst.has(p.artikelnr))
}

/** Voeg meerdere producten toe aan een prijslijst. Defaultprijs = producten.verkoopprijs (NULL → 0). */
export async function addProductenAanPrijslijst(
  prijslijstNr: string,
  producten: { artikelnr: string; prijs: number; omschrijving: string | null; gewicht: number | null; ean_code: string | null }[],
) {
  if (producten.length === 0) return
  const rows = producten.map((p) => ({
    prijslijst_nr: prijslijstNr,
    artikelnr: p.artikelnr,
    prijs: p.prijs,
    omschrijving: p.omschrijving,
    gewicht: p.gewicht,
    ean_code: p.ean_code,
  }))
  const { error } = await supabase.from('prijslijst_regels').insert(rows)
  if (error) throw error
}

/** Verwijder één regel uit een prijslijst. */
export async function removePrijslijstRegel(regelId: number) {
  const { error } = await supabase
    .from('prijslijst_regels')
    .delete()
    .eq('id', regelId)
  if (error) throw error
}

/**
 * Verwijder een prijslijst-header. Regels gaan automatisch mee via CASCADE,
 * maar als er nog `debiteuren` aan gekoppeld zijn faalt de delete met een
 * FK-error (geen ON DELETE op `debiteuren.prijslijst_nr`). Bel deze functie
 * dus alleen na een client-side check op gekoppelde klanten.
 */
export async function deletePrijslijst(nr: string) {
  const { error } = await supabase.from('prijslijst_headers').delete().eq('nr', nr)
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
