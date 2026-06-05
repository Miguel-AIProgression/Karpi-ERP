import { supabase } from '@/lib/supabase/client'

export interface LeverancierOverzichtRow {
  id: number
  leverancier_nr: number | null
  naam: string
  woonplaats: string | null
  actief: boolean
  openstaande_orders: number
  openstaande_meters: number
  eerstvolgende_levering: string | null
}

export interface LeverancierDetail {
  id: number
  leverancier_nr: number | null
  naam: string
  woonplaats: string | null
  adres: string | null
  postcode: string | null
  land: string | null
  contactpersoon: string | null
  telefoon: string | null
  email: string | null
  betaalconditie: string | null
  actief: boolean
  created_at: string
  updated_at: string
}

export interface LeverancierFormData {
  leverancier_nr?: number | null
  naam: string
  woonplaats?: string | null
  adres?: string | null
  postcode?: string | null
  land?: string | null
  contactpersoon?: string | null
  telefoon?: string | null
  email?: string | null
  betaalconditie?: string | null
  actief?: boolean
}

export async function fetchLeveranciersOverzicht(): Promise<LeverancierOverzichtRow[]> {
  const { data, error } = await supabase
    .from('leveranciers_overzicht')
    .select('*')
    .order('naam')
  if (error) throw error
  return (data ?? []).map((r) => ({
    id: r.id,
    leverancier_nr: r.leverancier_nr,
    naam: r.naam,
    woonplaats: r.woonplaats,
    actief: r.actief,
    openstaande_orders: Number(r.openstaande_orders ?? 0),
    openstaande_meters: Number(r.openstaande_meters ?? 0),
    eerstvolgende_levering: r.eerstvolgende_levering,
  }))
}

export async function fetchLeverancierDetail(id: number): Promise<LeverancierDetail> {
  const { data, error } = await supabase
    .from('leveranciers')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return data as LeverancierDetail
}

export async function createLeverancier(data: LeverancierFormData): Promise<LeverancierDetail> {
  const { data: inserted, error } = await supabase
    .from('leveranciers')
    .insert(data)
    .select()
    .single()
  if (error) throw error
  return inserted as LeverancierDetail
}

export async function updateLeverancier(id: number, data: Partial<LeverancierFormData>): Promise<void> {
  const { error } = await supabase
    .from('leveranciers')
    .update(data)
    .eq('id', id)
  if (error) throw error
}

export async function toggleLeverancierActief(id: number, actief: boolean): Promise<void> {
  const { error } = await supabase
    .from('leveranciers')
    .update({ actief })
    .eq('id', id)
  if (error) throw error
}

export interface LeverancierPortalInfo {
  portal_token: string
}

export async function fetchLeverancierPortalToken(id: number): Promise<LeverancierPortalInfo | null> {
  const { data, error } = await supabase
    .from('leveranciers')
    .select('portal_token')
    .eq('id', id)
    .single()
  if (error) throw error
  return data as LeverancierPortalInfo
}

export interface OpenRegelRow {
  regel_id: number
  inkooporder_id: number
  inkooporder_nr: string
  order_status: string
  besteldatum: string | null
  leverweek: string | null
  verwacht_datum: string | null
  regel_verwacht_datum: string | null
  order_verwacht_datum: string | null
  regelnummer: number
  artikelnr: string | null
  karpi_code: string | null
  artikel_omschrijving: string | null
  product_omschrijving: string | null
  kwaliteit_code: string | null
  kleur_code: string | null
  besteld_m: number
  geleverd_m: number
  te_leveren_m: number
  eenheid: string
  eta_bijgewerkt_door: 'karpi' | 'leverancier' | null
  eta_bijgewerkt_op: string | null
  leverancier_notitie: string | null
}

export async function fetchOpenRegelsVoorLeverancier(leverancierId: number): Promise<OpenRegelRow[]> {
  const { data, error } = await supabase
    .from('openstaande_inkooporder_regels')
    .select(
      `regel_id, inkooporder_id, inkooporder_nr, order_status,
       besteldatum, leverweek, verwacht_datum, regel_verwacht_datum, order_verwacht_datum,
       regelnummer, artikelnr, karpi_code, artikel_omschrijving, product_omschrijving,
       kwaliteit_code, kleur_code,
       besteld_m, geleverd_m, te_leveren_m,
       eta_bijgewerkt_door, eta_bijgewerkt_op, leverancier_notitie`,
    )
    .eq('leverancier_id', leverancierId)
    .order('verwacht_datum', { ascending: true, nullsFirst: false })
    .order('inkooporder_nr', { ascending: true })
    .order('regelnummer', { ascending: true })
  if (error) throw error

  // Enrich with eenheid from base table (not in view)
  const regelIds = (data ?? []).map((r) => (r as { regel_id: number }).regel_id)
  const eenheidMap = new Map<number, string>()
  if (regelIds.length > 0) {
    const { data: eenheden } = await supabase
      .from('inkooporder_regels')
      .select('id, eenheid')
      .in('id', regelIds)
    for (const e of eenheden ?? []) {
      eenheidMap.set((e as { id: number }).id, (e as { eenheid: string }).eenheid)
    }
  }

  return (data ?? []).map((r) => ({
    ...(r as OpenRegelRow),
    eenheid: eenheidMap.get((r as { regel_id: number }).regel_id) ?? 'm',
  }))
}

export async function updateRegelEta(
  regelId: number,
  verwachtDatum: string,
  leverancierId: number,
  notitie?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('update_regel_eta', {
    p_regel_id: regelId,
    p_verwacht_datum: verwachtDatum,
    p_door: 'karpi',
    p_leverancier_id: leverancierId,
    p_notitie: notitie ?? null,
  })
  if (error) throw error
}
