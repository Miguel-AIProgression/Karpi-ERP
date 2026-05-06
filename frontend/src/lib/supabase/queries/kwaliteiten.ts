import { supabase } from '../client'

export interface KwaliteitMetGewicht {
  code: string
  omschrijving: string | null
  collectie_id: number | null
  standaard_breedte_cm: number | null
  gewicht_per_m2_kg: number | null
  aantal_producten: number
}

/**
 * Voor instellingen-pagina /instellingen/kwaliteiten — leest alle kwaliteiten
 * met huidig gewicht-density + aantal gekoppelde producten (voor context).
 *
 * Gebruikt rpc-vrije aggregatie: één SELECT op kwaliteiten en daarna
 * client-side merge van product-counts. Karpi heeft ~1000 kwaliteiten →
 * volledige fetch is acceptabel; bij groei migreren naar SQL-view.
 */
export async function fetchKwaliteitenMetGewicht(): Promise<KwaliteitMetGewicht[]> {
  const [{ data: kwData, error: kwError }, { data: pcData, error: pcError }] = await Promise.all([
    supabase
      .from('kwaliteiten')
      .select('code, omschrijving, collectie_id, standaard_breedte_cm, gewicht_per_m2_kg')
      .order('code'),
    supabase
      .from('producten')
      .select('kwaliteit_code')
      .eq('actief', true)
      .not('kwaliteit_code', 'is', null),
  ])

  if (kwError) throw kwError
  if (pcError) throw pcError

  const counts = new Map<string, number>()
  for (const row of pcData ?? []) {
    const k = row.kwaliteit_code as string | null
    if (!k) continue
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }

  return (kwData ?? []).map((q) => ({
    code: q.code,
    omschrijving: q.omschrijving,
    collectie_id: q.collectie_id,
    standaard_breedte_cm: q.standaard_breedte_cm,
    gewicht_per_m2_kg: q.gewicht_per_m2_kg,
    aantal_producten: counts.get(q.code) ?? 0,
  }))
}

export async function updateKwaliteitGewicht(code: string, gewichtPerM2Kg: number | null): Promise<void> {
  const { error } = await supabase
    .from('kwaliteiten')
    .update({ gewicht_per_m2_kg: gewichtPerM2Kg })
    .eq('code', code)
  if (error) throw error
}

export interface KwaliteitInfo {
  code: string
  omschrijving: string | null
  gewicht_per_m2_kg: number | null
  standaard_breedte_cm: number | null
}

/** Single kwaliteit-fetch voor product-detail enrichment */
export async function fetchKwaliteitInfo(code: string | null): Promise<KwaliteitInfo | null> {
  if (!code) return null
  const { data, error } = await supabase
    .from('kwaliteiten')
    .select('code, omschrijving, gewicht_per_m2_kg, standaard_breedte_cm')
    .eq('code', code)
    .maybeSingle()
  if (error) throw error
  return data
}
