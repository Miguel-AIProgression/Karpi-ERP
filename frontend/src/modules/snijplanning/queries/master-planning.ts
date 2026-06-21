// Productie Master Planning (2026-06-21): planner-overzicht per orderregel —
// breder dan haalbaarheid.ts, toont ook al-gesneden/in afwerking/klaar-voor-
// verzending stukken (binnen nog openstaande orders) zodat de "Actueel"-kolom
// de volledige levenscyclus laat zien. Bron: dezelfde `snijplanning_overzicht`-
// view, uitgebreid met `order_status` (mig 457) om openstaande orders te
// filteren zonder een 2e round-trip naar `orders`.
import { supabase } from '@/lib/supabase/client'
import type { LeverType } from '@/lib/orders/snij-haalbaarheid'

export interface MasterPlanningRow {
  id: number
  snijplan_nr: string
  status: string
  order_status: string
  order_id: number
  order_nr: string
  debiteur_nr: number
  klant_naam: string
  kwaliteit_code: string | null
  kleur_code: string | null
  snij_lengte_cm: number
  snij_breedte_cm: number
  maatwerk_vorm: string | null
  maatwerk_afwerking: string | null
  orderaantal: number
  order_regel_id: number
  afleverdatum: string | null
  lever_type: LeverType
  rol_id: number | null
  rolnummer: string | null
  verwacht_inkooporder_regel_id: number | null
  gesneden_datum: string | null
}

/** Orders die niet meer "openstaand" zijn — zelfde paar als elders in de
 *  codebase (bv. EINDSTATUS_ORDERS in order-regels-table.tsx), hier inline
 *  zoals de bestaande conventie. */
const EINDSTATUS_ORDERS = ['Verzonden', 'Geannuleerd']

export async function fetchMasterPlanningRegels(): Promise<MasterPlanningRow[]> {
  // Gepagineerd tegen de PostgREST max-rows-cap (1000) — zelfde patroon als
  // fetchMaatwerkHaalbaarheid, met een bredere (niet-Geannuleerd) statusscope.
  const all: MasterPlanningRow[] = []
  const pageSize = 1000
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('snijplanning_overzicht')
      .select(
        `id, snijplan_nr, status, order_status, order_id, order_nr, debiteur_nr, klant_naam,
         kwaliteit_code, kleur_code, snij_lengte_cm, snij_breedte_cm, maatwerk_vorm,
         maatwerk_afwerking, orderaantal, order_regel_id,
         afleverdatum, lever_type, rol_id, rolnummer, verwacht_inkooporder_regel_id, gesneden_datum`,
      )
      .eq('snijden_uit_standaardmaat', false)
      .neq('status', 'Geannuleerd')
      .not('order_status', 'in', `(${EINDSTATUS_ORDERS.map((s) => `"${s}"`).join(',')})`)
      .not('afleverdatum', 'is', null)
      .order('id')
      .range(from, from + pageSize - 1)

    if (error) throw error
    const batch = (data ?? []) as MasterPlanningRow[]
    all.push(...batch)
    if (batch.length < pageSize) break
    from += pageSize
  }
  return all
}
