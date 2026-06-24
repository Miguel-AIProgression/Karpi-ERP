// Productie Master Planning (2026-06-21): planner-overzicht per orderregel —
// breder dan haalbaarheid.ts, toont ook al-gesneden/in afwerking/klaar-voor-
// verzending stukken (binnen nog openstaande orders) zodat de "Actueel"-kolom
// de volledige levenscyclus laat zien. Bron: dezelfde `snijplanning_overzicht`-
// view, uitgebreid met `order_status` (mig 457) om openstaande orders te
// filteren zonder een 2e round-trip naar `orders`.
import { supabase } from '@/lib/supabase/client'
import { fetchAllPaginated } from '@/lib/utils/paginate'
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
  return fetchAllPaginated<MasterPlanningRow>((from, to) =>
    supabase
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
      .range(from, to) as unknown as PromiseLike<{ data: MasterPlanningRow[] | null; error: unknown }>,
  )
}

/** snijplan_id → voorstel_id voor stukken die al een plaatsing hebben in een
 *  nog niet beoordeeld ('concept') snijvoorstel (Verdringingsrisico/rode FIFO-
 *  badge, mig 459). Zonder deze koppeling labelt Master Planning zo'n stuk
 *  als "materiaaltekort" terwijl er al een voorstel met geldige rol klaarstaat
 *  — het wacht alleen op een planner-klik in "Te beoordelen", niet op
 *  materiaal. */
export async function fetchConceptSnijplanVoorstelMap(): Promise<Map<number, number>> {
  const rows = await fetchAllPaginated<{ snijplan_id: number; voorstel_id: number }>((from, to) =>
    supabase
      .from('snijvoorstel_plaatsingen')
      .select('snijplan_id, voorstel_id, snijvoorstellen!inner(status)')
      .eq('snijvoorstellen.status', 'concept')
      .order('snijplan_id')
      .range(from, to) as unknown as PromiseLike<{
      data: Array<{ snijplan_id: number; voorstel_id: number }> | null
      error: unknown
    }>,
  )
  const map = new Map<number, number>()
  for (const row of rows) map.set(row.snijplan_id, row.voorstel_id)
  return map
}
