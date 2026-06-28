// Werklijst voor de snijderij: alle openstaande maatwerk-stukken die nog
// gesneden moeten worden, gefilterd op status en gegroepeerd per kwaliteit/kleur.
// Puur read-only — raakt geen tabellen of triggers.
//
// Statusfilter (vastgesteld met gebruiker 2026-06-28):
//   TOON:  Wacht, Gepland, Wacht op inkoop, Snijden
//   VERBERG: Gesneden en alles daarna (In confectie / Gereed / Ingepakt / Geannuleerd)

import { supabase } from '@/lib/supabase/client'
import { fetchAllPaginated } from '@/lib/utils/paginate'
import type { LeverType } from '@/lib/orders/snij-haalbaarheid'

export type WerklijstStatus = 'Wacht' | 'Gepland' | 'Wacht op inkoop' | 'Snijden'

export interface WerklijstRow {
  id: number
  snijplan_nr: string
  status: WerklijstStatus
  // Kwaliteit/kleur (COALESCE uit view: rol → product → maatwerk_code)
  kwaliteit_code: string | null
  kleur_code: string | null
  karpi_code: string | null
  // Maatwerk-specificaties van de orderregel
  maatwerk_lengte_cm: number | null
  maatwerk_breedte_cm: number | null
  maatwerk_vorm: string | null
  maatwerk_afwerking: string | null
  maatwerk_band_kleur: string | null
  orderaantal: number | null
  // Order-context
  order_regel_id: number
  order_id: number
  order_nr: string
  klant_naam: string
  debiteur_nr: number
  afleverdatum: string | null
  lever_type: LeverType
  verzendweek: string | null
  // Packing-positie (aanwezig als status = Gepland/Snijden)
  snij_lengte_cm: number
  snij_breedte_cm: number
  marge_cm: number
  placed_lengte_cm: number
  placed_breedte_cm: number
  positie_x_cm: number | null
  positie_y_cm: number | null
  geroteerd: boolean | null
  // Rol-info (aanwezig als status = Gepland/Snijden)
  rol_id: number | null
  rolnummer: string | null
  rol_breedte_cm: number | null
  rol_lengte_cm: number | null
  // IO-claim (aanwezig als status = Wacht op inkoop)
  verwacht_inkooporder_regel_id: number | null
  // Overige vlaggen
  is_handmatig_toegewezen: boolean
  express: boolean
}

const WERKLIJST_STATUSSEN: WerklijstStatus[] = ['Wacht', 'Gepland', 'Wacht op inkoop', 'Snijden']

/**
 * Haalt alle openstaande maatwerk-stukken op die nog gesneden moeten worden.
 * Gepagineerd (>1000 stukken mogelijk). Sortering op id voor stabiele paginering.
 */
export async function fetchWerklijstStukken(): Promise<WerklijstRow[]> {
  return fetchAllPaginated<WerklijstRow>((from, to) =>
    supabase
      .from('snijplanning_overzicht')
      .select(
        `id, snijplan_nr, status,
         kwaliteit_code, kleur_code, karpi_code,
         maatwerk_lengte_cm, maatwerk_breedte_cm, maatwerk_vorm, maatwerk_afwerking, maatwerk_band_kleur,
         orderaantal, order_regel_id, order_id, order_nr, klant_naam, debiteur_nr,
         afleverdatum, lever_type, verzendweek,
         snij_lengte_cm, snij_breedte_cm, marge_cm, placed_lengte_cm, placed_breedte_cm,
         positie_x_cm, positie_y_cm, geroteerd,
         rol_id, rolnummer, rol_breedte_cm, rol_lengte_cm,
         verwacht_inkooporder_regel_id, is_handmatig_toegewezen, express`,
      )
      .eq('snijden_uit_standaardmaat', false)
      .in('status', WERKLIJST_STATUSSEN)
      .order('id')
      .range(from, to) as unknown as PromiseLike<{ data: WerklijstRow[] | null; error: unknown }>,
  )
}
