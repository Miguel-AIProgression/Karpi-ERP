import { supabase } from '@/lib/supabase/client'

/** Eén colli-rij voor de bundel-sectie (incl. bundel-velden + maten). */
export interface ColliBundelRij {
  id: number
  colli_nr: number
  sscc: string | null
  gewicht_kg: number | null
  lengte_cm: number | null
  breedte_cm: number | null
  omschrijving_snapshot: string | null
  klant_omschrijving_snapshot: string | null
  order_regel_id: number | null
  bundel_colli_id: number | null
  is_bundel: boolean
}

/** Actieve aanmelding bij Rhenus (om dubbel-aanmelden/bundelen-na-aanmelden te tonen). */
export interface RhenusAanmeldStatus {
  status: string
}

export async function fetchZendingColliVoorBundel(zendingId: number): Promise<ColliBundelRij[]> {
  const { data, error } = await supabase
    .from('zending_colli')
    .select(
      'id, colli_nr, sscc, gewicht_kg, lengte_cm, breedte_cm, omschrijving_snapshot, ' +
        'klant_omschrijving_snapshot, order_regel_id, bundel_colli_id, is_bundel',
    )
    .eq('zending_id', zendingId)
    .order('colli_nr', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as ColliBundelRij[]
}

/** Laatste actieve Rhenus-transportorder (Wachtrij/Bezig/Verstuurd), of null.
 *  Mig 424 (ADR-0038): geconsolideerde `verzend_wachtrij`, gefilterd op vervoerder. */
export async function fetchRhenusAanmelding(zendingId: number): Promise<RhenusAanmeldStatus | null> {
  const { data, error } = await supabase
    .from('verzend_wachtrij')
    .select('status')
    .eq('vervoerder_code', 'rhenus_sftp')
    .eq('zending_id', zendingId)
    .in('status', ['Wachtrij', 'Bezig', 'Verstuurd'])
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data as RhenusAanmeldStatus | null) ?? null
}

export async function maakColliBundel(p: {
  zendingId: number
  colliIds: number[]
  gewichtKg?: number | null
  lengteCm?: number | null
  breedteCm?: number | null
  /** Mig 485: HST-pallet-type (EP/SP) → PackageUnitID; null voor Rhenus. */
  palletType?: string | null
}): Promise<number> {
  const { data, error } = await supabase.rpc('maak_colli_bundel', {
    p_zending_id: p.zendingId,
    p_colli_ids: p.colliIds,
    p_gewicht_kg: p.gewichtKg ?? null,
    p_lengte_cm: p.lengteCm ?? null,
    p_breedte_cm: p.breedteCm ?? null,
    p_pallet_type: p.palletType ?? null,
  })
  if (error) throw error
  return data as number
}

export async function verwijderColliBundel(bundelColliId: number): Promise<void> {
  const { error } = await supabase.rpc('verwijder_colli_bundel', {
    p_bundel_colli_id: bundelColliId,
  })
  if (error) throw error
}

export async function meldZendingHandmatigAan(zendingId: number): Promise<string> {
  const { data, error } = await supabase.rpc('meld_zending_handmatig_aan', {
    p_zending_id: zendingId,
  })
  if (error) throw error
  return data as string
}
