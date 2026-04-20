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
  parallelle_werkplekken: number
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
  const { data, error } = await supabase.rpc('voltooi_confectie', {
    p_snijplan_id: snijplan_id,
    p_afgerond: afgerond,
    p_ingepakt: ingepakt,
    p_locatie: locatie,
  })
  if (error) throw error
  return data
}

export async function startConfectie(snijplan_id: number) {
  const { data, error } = await supabase.rpc('start_confectie', { p_snijplan_id: snijplan_id })
  if (error) throw error
  return data
}

export async function updateConfectieWerktijd(
  type_bewerking: string,
  velden: Partial<Pick<ConfectieWerktijd, 'minuten_per_meter' | 'wisseltijd_minuten' | 'parallelle_werkplekken' | 'actief'>>,
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

export interface ConfectiePlanningForwardRow {
  // Primaire identifiers
  snijplan_id: number
  snijplan_nr: string
  scancode: string | null
  snijplan_status: string
  // Backward-compat aliassen (voor bestaande LaneKolom/AfrondModal/overview)
  confectie_id: number          // = snijplan_id
  confectie_nr: string           // = snijplan_nr
  status: string                 // = snijplan_status
  snij_lengte_cm: number | null  // = lengte_cm
  snij_breedte_cm: number | null // = breedte_cm
  maatwerk_vorm: string | null   // = vorm (andere alias)
  // Lane + derived
  type_bewerking: string | null
  order_regel_id: number
  order_id: number
  order_nr: string
  klant_naam: string | null
  maatwerk_afwerking: string | null
  maatwerk_band_kleur: string | null
  maatwerk_instructies: string | null
  vorm: string | null
  lengte_cm: number | null
  breedte_cm: number | null
  strekkende_meter_cm: number | null
  rol_id: number | null
  rolnummer: string | null
  kwaliteit_code: string | null
  kleur_code: string | null
  afleverdatum: string | null
  // Afrond-velden
  confectie_afgerond_op: string | null
  ingepakt_op: string | null
  locatie: string | null
  // Vooruitkijk
  confectie_klaar_op: string | null  // rol-klaar + buffer (ISO timestamp)
  confectie_startdatum: string
  opmerkingen: string | null
}

export async function fetchConfectiePlanningForward(): Promise<ConfectiePlanningForwardRow[]> {
  const { data, error } = await supabase
    .from('confectie_planning_forward')
    .select('*')
    .order('confectie_startdatum', { ascending: true })
  if (error) throw error
  return (data ?? []) as ConfectiePlanningForwardRow[]
}
