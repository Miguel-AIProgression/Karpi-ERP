import { supabase } from '@/lib/supabase/client'

/**
 * Klant-eigen kwaliteit-aliassen op debiteur- en inkoopgroep-niveau.
 *
 * Elke rij in `klanteigen_namen` hoort precies bij één van beide niveaus
 * (XOR-constraint, mig 200). De resolutie-volgorde tijdens lookup is
 * klant > inkoopgroep, en per niveau (kwaliteit + kleur) > (kwaliteit, NULL).
 *
 * SQL-RPC `resolve_klanteigen_naam` is single source of truth — geen
 * TS-spiegel van de fallback-logica. Frontend-display gaat via slot-component
 * `<KlantBenaming/>`; backend-callers (factuur-RPC, EDI-builder) consumeren
 * de RPC direct.
 */

export interface KlanteigenRow {
  id: number
  debiteur_nr: number | null
  inkoopgroep_code: string | null
  kwaliteit_code: string
  kleur_code: string | null
  benaming: string
  omschrijving: string | null
  leverancier: string | null
  bron: string | null
}

export interface KlanteigenVoorKlantRow {
  id: number | null
  inkoopgroep_row_id: number | null
  kwaliteit_code: string
  kleur_code: string | null
  benaming: string
  omschrijving: string | null
  leverancier: string | null
  bron_niveau: 'klant' | 'inkoopgroep'
  inkoopgroep_code: string | null
}

export interface KlanteigenVoorInkoopgroepRow {
  id: number
  kwaliteit_code: string
  kleur_code: string | null
  benaming: string
  omschrijving: string | null
  leverancier: string | null
}

export async function fetchKlanteigenVoorKlant(
  debiteurNr: number,
): Promise<KlanteigenVoorKlantRow[]> {
  const { data: klantData, error: e1 } = await supabase
    .from('klanteigen_namen')
    .select('id, kwaliteit_code, kleur_code, benaming, omschrijving, leverancier')
    .eq('debiteur_nr', debiteurNr)
    .order('kwaliteit_code')
  if (e1) throw e1

  const klantRijen: KlanteigenVoorKlantRow[] = (klantData ?? []).map((r) => ({
    id: r.id as number,
    inkoopgroep_row_id: null,
    kwaliteit_code: r.kwaliteit_code as string,
    kleur_code: (r.kleur_code as string | null) ?? null,
    benaming: r.benaming as string,
    omschrijving: (r.omschrijving as string | null) ?? null,
    leverancier: (r.leverancier as string | null) ?? null,
    bron_niveau: 'klant',
    inkoopgroep_code: null,
  }))

  const { data: deb, error: eDeb } = await supabase
    .from('debiteuren')
    .select('inkoopgroep_code')
    .eq('debiteur_nr', debiteurNr)
    .maybeSingle()
  if (eDeb) throw eDeb
  const groepCode = (deb?.inkoopgroep_code as string | null) ?? null
  if (!groepCode) return klantRijen

  const { data: groepData, error: e2 } = await supabase
    .from('klanteigen_namen')
    .select('id, kwaliteit_code, kleur_code, benaming, omschrijving, leverancier')
    .eq('inkoopgroep_code', groepCode)
  if (e2) throw e2

  const klantKey = (k: string, c: string | null) => `${k}__${c ?? ''}`
  const overschreven = new Set(klantRijen.map((r) => klantKey(r.kwaliteit_code, r.kleur_code)))

  const groepRijen: KlanteigenVoorKlantRow[] = (groepData ?? [])
    .filter((r) => !overschreven.has(klantKey(r.kwaliteit_code as string, (r.kleur_code as string | null) ?? null)))
    .map((r) => ({
      id: null,
      inkoopgroep_row_id: r.id as number,
      kwaliteit_code: r.kwaliteit_code as string,
      kleur_code: (r.kleur_code as string | null) ?? null,
      benaming: r.benaming as string,
      omschrijving: (r.omschrijving as string | null) ?? null,
      leverancier: (r.leverancier as string | null) ?? null,
      bron_niveau: 'inkoopgroep',
      inkoopgroep_code: groepCode,
    }))

  return [...klantRijen, ...groepRijen].sort((a, b) =>
    a.kwaliteit_code.localeCompare(b.kwaliteit_code),
  )
}

export async function fetchKlanteigenVoorInkoopgroep(
  inkoopgroepCode: string,
): Promise<KlanteigenVoorInkoopgroepRow[]> {
  const { data, error } = await supabase
    .from('klanteigen_namen')
    .select('id, kwaliteit_code, kleur_code, benaming, omschrijving, leverancier')
    .eq('inkoopgroep_code', inkoopgroepCode)
    .order('kwaliteit_code')
  if (error) throw error
  return (data ?? []) as KlanteigenVoorInkoopgroepRow[]
}

/**
 * Resolver: één klant-eigen naam met fallback klant+kleur > klant+NULL >
 * inkoopgroep+kleur > inkoopgroep+NULL > NULL. Imperatief aanroepbaar voor
 * niet-render-callers (bv. order-form artikel-selectie). Render-callers
 * gebruiken `<KlantBenaming/>` slot-component.
 */
export async function fetchKlanteigenNaam(
  debiteurNr: number,
  kwaliteitCode: string,
  kleurCode?: string | null,
): Promise<{ benaming: string; omschrijving: string | null } | null> {
  const { data, error } = await supabase.rpc('resolve_klanteigen_naam', {
    p_debiteur_nr: debiteurNr,
    p_kwaliteit_code: kwaliteitCode,
    p_kleur_code: kleurCode ?? null,
  })

  if (error) throw error
  const benaming = data as string | null
  return benaming ? { benaming, omschrijving: null } : null
}

/**
 * Resolver-batch: alle klant-eigen namen voor een debiteur als Map met
 * key `${kwaliteit_code}_${kleur_code ?? ''}`. Gebruikt door orders-laag
 * bij regel-rendering om in één round-trip alle aliassen op te halen.
 */
export async function fetchKlanteigenNamenMap(
  debiteurNr: number,
): Promise<Map<string, string>> {
  const { data, error } = await supabase.rpc('resolve_klanteigen_namen_voor_debiteur', {
    p_debiteur_nr: debiteurNr,
  })
  if (error) throw error
  const rows = (data ?? []) as { kwaliteit_code: string; kleur_code: string | null; benaming: string }[]
  return new Map(rows.map((n) => [`${n.kwaliteit_code}_${n.kleur_code ?? ''}`, n.benaming]))
}

export interface KlanteigenInsert {
  debiteur_nr?: number | null
  inkoopgroep_code?: string | null
  kwaliteit_code: string
  kleur_code?: string | null
  benaming: string
  omschrijving?: string | null
  leverancier?: string | null
}

export async function upsertKlanteigenNaam(row: KlanteigenInsert): Promise<number> {
  const { data, error } = await supabase.rpc('upsert_klanteigen_naam', {
    p_debiteur_nr: row.debiteur_nr ?? null,
    p_inkoopgroep_code: row.inkoopgroep_code ?? null,
    p_kwaliteit_code: row.kwaliteit_code,
    p_kleur_code: row.kleur_code ?? null,
    p_benaming: row.benaming,
    p_omschrijving: row.omschrijving ?? null,
    p_leverancier: row.leverancier ?? null,
    p_bron: 'ui',
  })
  if (error) throw error
  return data as number
}

export async function updateKlanteigenNaam(
  id: number,
  patch: { benaming?: string; omschrijving?: string | null; leverancier?: string | null; kleur_code?: string | null },
): Promise<void> {
  const { error } = await supabase
    .from('klanteigen_namen')
    .update(patch)
    .eq('id', id)
  if (error) throw error
}

export async function deleteKlanteigenNaam(id: number): Promise<void> {
  const { error } = await supabase.from('klanteigen_namen').delete().eq('id', id)
  if (error) throw error
}

export async function fetchKwaliteitCodes(): Promise<{ code: string; omschrijving: string | null }[]> {
  const all: { code: string; omschrijving: string | null }[] = []
  const pageSize = 1000
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('kwaliteiten')
      .select('code, omschrijving')
      .order('code')
      .range(from, from + pageSize - 1)
    if (error) throw error
    const batch = (data ?? []) as typeof all
    all.push(...batch)
    if (batch.length < pageSize) break
    from += pageSize
  }
  return all
}
