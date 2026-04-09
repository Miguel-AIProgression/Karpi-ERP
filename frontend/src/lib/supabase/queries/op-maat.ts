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
}

export async function fetchKleurenVoorKwaliteit(kwaliteitCode: string): Promise<KleurOptie[]> {
  const { data, error } = await supabase.rpc('kleuren_voor_kwaliteit', {
    p_kwaliteit: kwaliteitCode,
  })
  if (error) throw error
  return (data ?? []) as KleurOptie[]
}
