import { supabase } from '@/lib/supabase/client'

/**
 * Conditie-shape voor selectieregels (V1 — mig 208).
 * Onbekende sleutels worden door de DB-evaluator genegeerd, dus uitbreiden
 * is non-breaking (zolang de evaluator-RPC ze ook leert kennen).
 */
export interface VerzendregelConditie {
  land?: string[]
  kleinste_zijde_cm_min?: number
  kleinste_zijde_cm_max?: number
  gewicht_kg_min?: number
  gewicht_kg_max?: number
  debiteur_nrs?: number[]
  inkoopgroep_codes?: string[]
}

export interface Verzendregel {
  id: number
  vervoerder_code: string
  prio: number
  conditie: VerzendregelConditie
  service_code: string | null
  actief: boolean
  notitie: string | null
  created_at: string
  updated_at: string
}

export interface VerzendregelInput {
  vervoerder_code: string
  prio: number
  conditie: VerzendregelConditie
  service_code: string | null
  actief: boolean
  notitie: string | null
}

const COLS = 'id, vervoerder_code, prio, conditie, service_code, actief, notitie, created_at, updated_at'

/**
 * Alle verzendregels voor een vervoerder, gesorteerd op prio.
 */
export async function fetchVerzendregelsVoorVervoerder(
  vervoerderCode: string,
): Promise<Verzendregel[]> {
  const { data, error } = await supabase
    .from('vervoerder_selectie_regels')
    .select(COLS)
    .eq('vervoerder_code', vervoerderCode)
    .order('prio', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw error
  return (data ?? []) as Verzendregel[]
}

/**
 * Alle verzendregels (over alle vervoerders), gesorteerd op prio. Gebruikt
 * door overzichten/audits en debug-views.
 */
export async function fetchAlleVerzendregels(): Promise<Verzendregel[]> {
  const { data, error } = await supabase
    .from('vervoerder_selectie_regels')
    .select(COLS)
    .order('prio', { ascending: true })
    .order('id', { ascending: true })

  if (error) throw error
  return (data ?? []) as Verzendregel[]
}

export async function createVerzendregel(input: VerzendregelInput): Promise<Verzendregel> {
  const { data, error } = await supabase
    .from('vervoerder_selectie_regels')
    .insert(input)
    .select(COLS)
    .single()

  if (error) throw error
  return data as Verzendregel
}

export async function updateVerzendregel(
  id: number,
  patch: Partial<VerzendregelInput>,
): Promise<void> {
  const { error } = await supabase
    .from('vervoerder_selectie_regels')
    .update(patch)
    .eq('id', id)

  if (error) throw error
}

export async function deleteVerzendregel(id: number): Promise<void> {
  const { error } = await supabase
    .from('vervoerder_selectie_regels')
    .delete()
    .eq('id', id)

  if (error) throw error
}
