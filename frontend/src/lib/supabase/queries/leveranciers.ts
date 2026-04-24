import { supabase } from '../client'

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
