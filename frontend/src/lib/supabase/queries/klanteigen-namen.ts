import { supabase } from '../client'

/**
 * Klant-eigen kwaliteit-aliassen op debiteur- en inkoopgroep-niveau.
 *
 * Elke rij in `klanteigen_namen` hoort precies bij één van beide niveaus
 * (XOR-constraint, mig 200). De resolutie-volgorde tijdens lookup is
 * klant > inkoopgroep, en per niveau (kwaliteit + kleur) > (kwaliteit, NULL).
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

/** Verrijkt met overerving-info voor de klant-tab. */
export interface KlanteigenVoorKlantRow {
  /** id van de bestaande klant-regel; NULL bij overgeërfde inkoopgroep-aliassen. */
  id: number | null
  /** id van de onderliggende inkoopgroep-regel als bron_niveau = 'inkoopgroep'. NULL bij klant-rijen. */
  inkoopgroep_row_id: number | null
  kwaliteit_code: string
  kleur_code: string | null
  benaming: string
  omschrijving: string | null
  leverancier: string | null
  /** 'klant' = eigen regel, 'inkoopgroep' = overerving via debiteuren.inkoopgroep_code. */
  bron_niveau: 'klant' | 'inkoopgroep'
  /** Inkoopgroep-code als bron_niveau = 'inkoopgroep', anders NULL. */
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

/**
 * Haalt alle aliassen op die voor een debiteur gelden — eigen + overerving.
 * Klant-niveau-rijen krijgen `bron_niveau='klant'`; inkoopgroep-rijen die nog
 * niet door een eigen regel zijn overschreven krijgen `bron_niveau='inkoopgroep'`.
 */
export async function fetchKlanteigenVoorKlant(
  debiteurNr: number,
): Promise<KlanteigenVoorKlantRow[]> {
  // 1) Klant-rijen
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

  // 2) Inkoopgroep-rijen die door deze debiteur worden geërfd
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

  // Filter overgeërfde rijen weg waar de klant zelf al een eigen regel heeft
  // op (kwaliteit_code, kleur_code) — die override telt.
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

/** Lijst kwaliteits-codes voor de "+ alias toevoegen"-dialog. */
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
