import { supabase } from '../client'

// === Vormen ===

export interface MaatwerkVormRow {
  id: number
  code: string
  naam: string
  afmeting_type: 'lengte_breedte' | 'diameter'
  toeslag: number
  actief: boolean
  volgorde: number
}

export async function fetchVormen(): Promise<MaatwerkVormRow[]> {
  const { data, error } = await supabase
    .from('maatwerk_vormen')
    .select('*')
    .eq('actief', true)
    .order('volgorde')
  if (error) throw error
  return data ?? []
}

export async function fetchAlleVormen(): Promise<MaatwerkVormRow[]> {
  const { data, error } = await supabase
    .from('maatwerk_vormen')
    .select('*')
    .order('volgorde')
  if (error) throw error
  return data ?? []
}

export async function upsertVorm(vorm: Omit<MaatwerkVormRow, 'id'> & { id?: number }) {
  const { error } = vorm.id
    ? await supabase.from('maatwerk_vormen').update(vorm).eq('id', vorm.id)
    : await supabase.from('maatwerk_vormen').insert(vorm)
  if (error) throw error
}

// === Afwerkingen ===

export interface AfwerkingTypeRow {
  id: number
  code: string
  naam: string
  prijs: number
  heeft_band_kleur: boolean
  actief: boolean
  volgorde: number
}

export async function fetchAfwerkingTypes(): Promise<AfwerkingTypeRow[]> {
  const { data, error } = await supabase
    .from('afwerking_types')
    .select('*')
    .eq('actief', true)
    .order('volgorde')
  if (error) throw error
  return data ?? []
}

export async function fetchAlleAfwerkingTypes(): Promise<AfwerkingTypeRow[]> {
  const { data, error } = await supabase
    .from('afwerking_types')
    .select('*')
    .order('volgorde')
  if (error) throw error
  return data ?? []
}

export async function upsertAfwerkingType(at: Omit<AfwerkingTypeRow, 'id'> & { id?: number }) {
  const { error } = at.id
    ? await supabase.from('afwerking_types').update(at).eq('id', at.id)
    : await supabase.from('afwerking_types').insert(at)
  if (error) throw error
}

// === Standaard afwerking per kwaliteit ===

export async function fetchStandaardAfwerking(kwaliteitCode: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('kwaliteit_standaard_afwerking')
    .select('afwerking_code')
    .eq('kwaliteit_code', kwaliteitCode)
    .maybeSingle()
  if (error) throw error
  return data?.afwerking_code ?? null
}

export async function setStandaardAfwerking(kwaliteitCode: string, afwerkingCode: string) {
  const { error } = await supabase
    .from('kwaliteit_standaard_afwerking')
    .upsert({ kwaliteit_code: kwaliteitCode, afwerking_code: afwerkingCode })
  if (error) throw error
}

// === Kwaliteiten (voor zoekbare combobox) ===

export interface KwaliteitOptie {
  code: string
  omschrijving: string
}

export async function fetchKwaliteiten(): Promise<KwaliteitOptie[]> {
  const { data, error } = await supabase
    .from('kwaliteiten')
    .select('code, omschrijving')
    .order('code')
  if (error) throw error
  return data ?? []
}

/**
 * Zoek het maatwerk-artikel (overig-type) voor een kwaliteit+kleur.
 * Probeert meerdere strategieën per kleurvariant (bijv. '16' en '16.0'):
 * 1. product_type='overig' (import-logica: geen BREED of CA: → overig)
 * 2. karpi_code bevat 'maatwerk'
 * 3. omschrijving bevat 'maatwerk'
 */
export async function fetchMaatwerkArtikelNr(kwaliteitCode: string, kleurCode: string): Promise<string | null> {
  const normKleur = kleurCode.replace(/\.0$/, '')
  const kleurVariants = Array.from(new Set([kleurCode, normKleur]))

  for (const kc of kleurVariants) {
    // Strategie 1: product_type='overig' én 'maatwerk' in naam/code
    // (sluit Contour/overige stukprijsproducten uit die geen m²-referentie zijn)
    const { data: d1 } = await supabase
      .from('producten').select('artikelnr')
      .eq('kwaliteit_code', kwaliteitCode).eq('kleur_code', kc)
      .eq('actief', true).eq('product_type', 'overig')
      .ilike('omschrijving', '%maatwerk%')
      .limit(1).maybeSingle()
    if (d1?.artikelnr) return d1.artikelnr

    // Strategie 2: karpi_code bevat 'maatwerk'
    const { data: d2 } = await supabase
      .from('producten').select('artikelnr')
      .eq('kwaliteit_code', kwaliteitCode).eq('kleur_code', kc)
      .eq('actief', true).ilike('karpi_code', '%maatwerk%')
      .limit(1).maybeSingle()
    if (d2?.artikelnr) return d2.artikelnr

    // Strategie 3: omschrijving bevat 'maatwerk'
    const { data: d3 } = await supabase
      .from('producten').select('artikelnr')
      .eq('kwaliteit_code', kwaliteitCode).eq('kleur_code', kc)
      .eq('actief', true).ilike('omschrijving', '%maatwerk%')
      .limit(1).maybeSingle()
    if (d3?.artikelnr) return d3.artikelnr
  }

  // Strategie 4: zoek via uitwisselgroepen — zelfde kleur, uitwisselbare kwaliteit
  // (bijv. VELV16 → CISC16 die wél een MAATWERK-artikel heeft)
  const { data: basisData } = await supabase
    .from('kwaliteit_kleur_uitwisselgroepen')
    .select('basis_code')
    .eq('kwaliteit_code', kwaliteitCode)
    .eq('kleur_code', normKleur)
    .limit(1).maybeSingle()
  if (basisData?.basis_code) {
    const { data: uitwisselData } = await supabase
      .from('kwaliteit_kleur_uitwisselgroepen')
      .select('kwaliteit_code')
      .eq('basis_code', basisData.basis_code)
      .neq('kwaliteit_code', kwaliteitCode)
    const uitwisselKwaliteiten = (uitwisselData ?? []).map((r) => r.kwaliteit_code)
    for (const uitKwal of uitwisselKwaliteiten) {
      for (const kc of kleurVariants) {
        const { data: du } = await supabase
          .from('producten').select('artikelnr')
          .eq('kwaliteit_code', uitKwal).eq('kleur_code', kc)
          .eq('actief', true).ilike('omschrijving', '%maatwerk%')
          .limit(1).maybeSingle()
        if (du?.artikelnr) return du.artikelnr
      }
    }
  }

  // Strategie 5: zelfde kwaliteit, andere kleur — laatste redmiddel
  const { data: d5 } = await supabase
    .from('producten').select('artikelnr')
    .eq('kwaliteit_code', kwaliteitCode)
    .eq('actief', true).ilike('omschrijving', '%maatwerk%')
    .limit(1).maybeSingle()
  if (d5?.artikelnr) return d5.artikelnr

  return null
}

/** Basis m²-prijs voor een kwaliteit uit maatwerk_m2_prijzen (kleur-onafhankelijk).
 *  Fallback wanneer geen kleur-specifiek MAATWERK-artikel gevonden wordt. */
export async function fetchKwaliteitM2Prijs(kwaliteitCode: string): Promise<number | null> {
  const { data } = await supabase
    .from('maatwerk_m2_prijzen')
    .select('verkoopprijs_m2')
    .eq('kwaliteit_code', kwaliteitCode)
    .not('verkoopprijs_m2', 'is', null)
    .limit(1)
    .maybeSingle()
  return data?.verkoopprijs_m2 ?? null
}

/** Zoek kwaliteiten via productnamen — vindt "CISC" bij zoekterm "cisco" */
export async function searchKwaliteitenViaProducten(term: string): Promise<KwaliteitOptie[]> {
  const { data, error } = await supabase
    .from('producten')
    .select('kwaliteit_code, kwaliteiten!inner(code, omschrijving)')
    .ilike('omschrijving', `%${term}%`)
    .eq('actief', true)
    .not('kwaliteit_code', 'is', null)
    .limit(200)
  if (error) throw error

  // Dedupliceer op kwaliteit_code
  const seen = new Set<string>()
  const result: KwaliteitOptie[] = []
  for (const row of data ?? []) {
    const k = row.kwaliteiten as unknown as { code: string; omschrijving: string }
    if (k?.code && !seen.has(k.code)) {
      seen.add(k.code)
      result.push({ code: k.code, omschrijving: k.omschrijving })
    }
  }
  return result.sort((a, b) => a.code.localeCompare(b.code)).slice(0, 30)
}

// === Kleuren via DB-functie (één query, geen client-side join) ===

export interface KleurOptie {
  kleur_code: string
  kleur_label: string           // display zonder '.0' (bijv. "11" ipv "11.0")
  omschrijving: string
  verkoopprijs_m2: number | null
  kostprijs_m2: number | null
  gewicht_per_m2_kg: number | null
  max_breedte_cm: number | null
  artikelnr: string | null      // rol-product artikelnr voor koppeling
  karpi_code: string | null     // rol-product karpi_code
  aantal_rollen: number         // eigen rollen met status 'beschikbaar'
  beschikbaar_m2: number        // vrij m² (alleen status 'beschikbaar')
  totaal_m2: number             // totaal fysiek aanwezig m² (excl. gesneden/verkocht)
  equiv_rollen: number          // rollen van uitwisselbare kwaliteiten
  equiv_m2: number              // m² van uitwisselbare rollen
  equiv_kwaliteit_code: string | null // beste uitwisselbare kwaliteit (meeste m²)
  equiv_artikelnr: string | null      // MAATWERK-artikelnr van die uitwisselbare kwaliteit+kleur — gebruikt als fysiek_artikelnr bij omstickeren
  equiv_m2_prijs: number | null       // m²-prijs van die uitwisselbare combinatie uit maatwerk_m2_prijzen
}

export async function fetchKleurenVoorKwaliteit(kwaliteitCode: string): Promise<KleurOptie[]> {
  const { data, error } = await supabase.rpc('kleuren_voor_kwaliteit', {
    p_kwaliteit: kwaliteitCode,
  })
  if (error) throw error
  return (data ?? []) as KleurOptie[]
}

// === Standaard maten per kwaliteit ===

export interface StandaardMaat {
  artikelnr: string
  karpi_code: string | null
  omschrijving: string
  verkoopprijs: number | null
  gewicht_kg: number | null
  vrije_voorraad: number
  besteld_inkoop: number
  kwaliteit_code: string | null
  kleur_code: string | null
  product_type: string | null
}

export async function fetchStandaardMatenVoorKwaliteit(kwaliteitCode: string): Promise<StandaardMaat[]> {
  const { data, error } = await supabase
    .from('producten')
    .select('artikelnr, karpi_code, omschrijving, verkoopprijs, gewicht_kg, vrije_voorraad, besteld_inkoop, kwaliteit_code, kleur_code, product_type')
    .eq('kwaliteit_code', kwaliteitCode)
    .eq('actief', true)
    .not('product_type', 'in', '("rol","staaltje")')
    .order('omschrijving')
  if (error) throw error
  return (data ?? []) as StandaardMaat[]
}
