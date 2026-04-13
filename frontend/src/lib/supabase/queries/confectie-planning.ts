import { supabase } from '../client'

export interface ConfectiePlanningRow {
  confectie_id: number
  confectie_nr: string
  scancode: string | null
  status: string
  type_bewerking: string
  order_regel_id: number
  order_id: number
  order_nr: string
  klant_naam: string
  afleverdatum: string | null
  kwaliteit_code: string | null
  kleur_code: string | null
  rol_id: number | null
  rolnummer: string | null
  lengte_cm: number | null
  breedte_cm: number | null
  vorm: string | null
  strekkende_meter_cm: number | null
  maatwerk_afwerking: string | null
  maatwerk_band_kleur: string | null
  maatwerk_instructies: string | null
  confectie_afgerond_op: string | null
  ingepakt_op: string | null
  locatie: string | null
}

export interface ConfectieWerktijd {
  type_bewerking: string
  minuten_per_meter: number
  wisseltijd_minuten: number
  actief: boolean
  bijgewerkt_op: string | null
}

export async function fetchConfectiePlanning(): Promise<ConfectiePlanningRow[]> {
  const { data, error } = await supabase
    .from('confectie_planning_overzicht')
    .select('*')
  if (error) throw error
  return (data ?? []) as ConfectiePlanningRow[]
}

export async function fetchConfectieWerktijden(): Promise<ConfectieWerktijd[]> {
  const { data, error } = await supabase
    .from('confectie_werktijden')
    .select('*')
    .order('type_bewerking', { ascending: true })
  if (error) throw error
  return (data ?? []) as ConfectieWerktijd[]
}

export interface AfrondConfectieInput {
  snijplan_id: number
  afgerond: boolean
  ingepakt: boolean
  locatie: string | null
}

export async function afrondConfectie({ snijplan_id, afgerond, ingepakt, locatie }: AfrondConfectieInput) {
  const nu = new Date().toISOString()
  const update: Record<string, unknown> = {
    locatie: locatie && locatie.trim() ? locatie.trim() : null,
    confectie_afgerond_op: afgerond || ingepakt ? nu : null,
    ingepakt_op: ingepakt ? nu : null,
  }
  if (ingepakt) update.status = 'Gereed'
  const { data, error } = await supabase
    .from('snijplannen')
    .update(update)
    .eq('id', snijplan_id)
    .select('id')
    .single()
  if (error) throw error
  return data
}

export async function updateConfectieWerktijd(
  type_bewerking: string,
  velden: Partial<Pick<ConfectieWerktijd, 'minuten_per_meter' | 'wisseltijd_minuten' | 'actief'>>,
): Promise<ConfectieWerktijd> {
  const { data, error } = await supabase
    .from('confectie_werktijden')
    .update(velden)
    .eq('type_bewerking', type_bewerking)
    .select('*')
    .single()
  if (error) throw error
  return data as ConfectieWerktijd
}
