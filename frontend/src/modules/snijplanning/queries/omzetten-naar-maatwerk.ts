import { supabase } from '@/lib/supabase/client'

/** Mig 472: kandidaat-rol voor een nog-niet-bestaande maatwerk-conversie
 *  (eigen + uitwisselbare kwaliteit/kleur, fysiek groot genoeg). */
export interface KandidaatRolVoorConversie {
  rol_id: number
  rolnummer: string
  breedte_cm: number
  lengte_cm: number
  status: string
  kwaliteit_code: string
  kleur_code: string
  is_exact: boolean
}

/** Toont of er materiaal is om een vaste-maat-regel uit te snijden, vóórdat
 *  de operator daadwerkelijk converteert — geen kandidaat = knop disabled. */
export async function fetchKandidaatRollenVoorConversie(params: {
  kwaliteitCode: string
  kleurCode: string
  lengteCm: number
  breedteCm: number
}): Promise<KandidaatRolVoorConversie[]> {
  const { data, error } = await supabase.rpc('kandidaat_rollen_voor_conversie', {
    p_kwaliteit_code: params.kwaliteitCode,
    p_kleur_code: params.kleurCode,
    p_lengte_cm: params.lengteCm,
    p_breedte_cm: params.breedteCm,
  })
  if (error) throw error
  return (data ?? []) as KandidaatRolVoorConversie[]
}

/** Zet een vaste-maat-orderregel om naar maatwerk (snijden uit een rol i.p.v.
 *  uit voorraad/inkoop bestellen). Triggert vanzelf snijplan-aanmaak + claim-
 *  release + status-herwaardering (zie mig 472-comments). */
export async function converteerRegelNaarMaatwerk(params: {
  orderRegelId: number
  lengteCm: number
  breedteCm?: number
  vorm?: string
}): Promise<void> {
  const { error } = await supabase.rpc('converteer_regel_naar_maatwerk', {
    p_order_regel_id: params.orderRegelId,
    p_lengte_cm: params.lengteCm,
    p_breedte_cm: params.breedteCm ?? null,
    p_vorm: params.vorm ?? 'rechthoek',
  })
  if (error) throw error
}
