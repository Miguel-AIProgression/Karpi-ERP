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
 * Voor instellingen-pagina /instellingen/kwaliteiten + producten-pagina —
 * leest alle kwaliteiten met huidig gewicht-density + aantal gekoppelde
 * producten (voor context).
 *
 * Producten worden gepagineerd opgehaald (Supabase default-limit = 1000
 * rijen per query); Karpi heeft ~26k producten dus we tellen via meerdere
 * pages. Bij groei migreren naar SQL-view met GROUP BY.
 */
export async function fetchKwaliteitenMetGewicht(): Promise<KwaliteitMetGewicht[]> {
  const PAGE_SIZE = 1000

  const kwPromise = supabase
    .from('kwaliteiten')
    .select('code, omschrijving, collectie_id, standaard_breedte_cm, gewicht_per_m2_kg')
    .order('code')

  // Producten gepagineerd ophalen tot we alles hebben
  const fetchAllProducten = async (): Promise<{ kwaliteit_code: string }[]> => {
    const all: { kwaliteit_code: string }[] = []
    let offset = 0
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await supabase
        .from('producten')
        .select('kwaliteit_code')
        .eq('actief', true)
        .not('kwaliteit_code', 'is', null)
        .range(offset, offset + PAGE_SIZE - 1)
      if (error) throw error
      if (!data || data.length === 0) break
      all.push(...(data as { kwaliteit_code: string }[]))
      if (data.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }
    return all
  }

  const [{ data: kwData, error: kwError }, pcData] = await Promise.all([
    kwPromise,
    fetchAllProducten(),
  ])

  if (kwError) throw kwError

  const counts = new Map<string, number>()
  for (const row of pcData) {
    const k = row.kwaliteit_code
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

/**
 * Update gewicht/m² voor een kwaliteit. Propageert automatisch naar alle
 * andere kwaliteiten in dezelfde uitwisselbare collectie — die delen per
 * definitie dezelfde fysieke eigenschappen (zelfde tapijt, andere kleur/
 * collectie-naam) en moeten dus dezelfde density hebben. Kwaliteiten zonder
 * collectie krijgen alleen zichzelf geüpdated.
 *
 * Returnt de codes die feitelijk geüpdated zijn — handig voor UI-feedback.
 */
export async function updateKwaliteitGewicht(code: string, gewichtPerM2Kg: number | null): Promise<string[]> {
  const { data: kwal, error: fetchErr } = await supabase
    .from('kwaliteiten')
    .select('collectie_id')
    .eq('code', code)
    .single()
  if (fetchErr) throw fetchErr

  let codes = [code]
  if (kwal?.collectie_id != null) {
    const { data: groep, error: groepErr } = await supabase
      .from('kwaliteiten')
      .select('code')
      .eq('collectie_id', kwal.collectie_id)
    if (groepErr) throw groepErr
    codes = (groep ?? []).map((k: { code: string }) => k.code)
    if (!codes.includes(code)) codes.push(code)
  }

  const { error } = await supabase
    .from('kwaliteiten')
    .update({ gewicht_per_m2_kg: gewichtPerM2Kg })
    .in('code', codes)
  if (error) throw error

  return codes
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
