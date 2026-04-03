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
}

/** Fetch all prijslijsten with linked klanten count */
export async function fetchPrijslijsten(): Promise<PrijslijstOverviewRow[]> {
  // Get all headers
  const { data: headers, error: hErr } = await supabase
    .from('prijslijst_headers')
    .select('nr, naam, geldig_vanaf, actief')
    .order('nr')

  if (hErr) throw hErr

  // Get klanten grouped by prijslijst_nr
  const { data: debiteuren, error: dErr } = await supabase
    .from('debiteuren')
    .select('debiteur_nr, naam, prijslijst_nr')
    .not('prijslijst_nr', 'is', null)

  if (dErr) throw dErr

  // Build klant map
  const klantMap: Record<string, { debiteur_nr: number; naam: string }[]> = {}
  for (const d of debiteuren ?? []) {
    const pnr = d.prijslijst_nr as string
    if (!klantMap[pnr]) klantMap[pnr] = []
    klantMap[pnr].push({ debiteur_nr: d.debiteur_nr as number, naam: d.naam as string })
  }

  // Get all regels for counting (select only prijslijst_nr for minimal payload)
  const { data: regels, error: rErr } = await supabase
    .from('prijslijst_regels')
    .select('prijslijst_nr')

  if (rErr) throw rErr

  // Build count map
  const countMap: Record<string, number> = {}
  for (const r of regels ?? []) {
    const pnr = r.prijslijst_nr as string
    countMap[pnr] = (countMap[pnr] ?? 0) + 1
  }

  return (headers ?? []).map((h) => ({
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

/** Fetch all regels for a prijslijst */
export async function fetchPrijslijstRegels(prijslijstNr: string): Promise<PrijslijstRegelRow[]> {
  const { data, error } = await supabase
    .from('prijslijst_regels')
    .select('id, artikelnr, omschrijving, omschrijving_2, prijs, gewicht, ean_code')
    .eq('prijslijst_nr', prijslijstNr)
    .order('artikelnr')

  if (error) throw error
  return (data ?? []) as PrijslijstRegelRow[]
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
