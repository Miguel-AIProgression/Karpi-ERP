// Fase 1 (2026-06-19): haalbaarheid-overzicht voor maatwerk-snijplan-stukken.
// Puur lezend — raakt de bestaande planner/packer niet. Bron: de bestaande
// `snijplanning_overzicht`-view (mig 331, uitgebreid met lever_type +
// verwacht_inkooporder_regel_id in mig 447).
import { supabase } from '@/lib/supabase/client'
import type { LeverType } from '@/lib/orders/snij-haalbaarheid'

export interface MaatwerkHaalbaarheidRow {
  id: number
  snijplan_nr: string
  status: string
  order_id: number
  order_nr: string
  debiteur_nr: number
  klant_naam: string
  kwaliteit_code: string | null
  kleur_code: string | null
  snij_lengte_cm: number
  snij_breedte_cm: number
  maatwerk_vorm: string | null
  afleverdatum: string | null
  lever_type: LeverType
  rolnummer: string | null
  verwacht_inkooporder_regel_id: number | null
}

/** Statussen die al voorbij de snij-stap zijn — niet relevant voor "halen we
 *  de snij-deadline" (die vraag is al beantwoord zodra er gesneden is). */
const TERMINALE_STATUSSEN = ['Gesneden', 'In confectie', 'Gereed', 'Ingepakt', 'Geannuleerd']

export async function fetchMaatwerkHaalbaarheid(): Promise<MaatwerkHaalbaarheidRow[]> {
  const { data, error } = await supabase
    .from('snijplanning_overzicht')
    .select(
      `id, snijplan_nr, status, order_id, order_nr, debiteur_nr, klant_naam,
       kwaliteit_code, kleur_code, snij_lengte_cm, snij_breedte_cm, maatwerk_vorm,
       afleverdatum, lever_type, rolnummer, verwacht_inkooporder_regel_id`,
    )
    .eq('snijden_uit_standaardmaat', false)
    // Status-namen bevatten spaties ("In confectie") — PostgREST vereist dan
    // quotes per waarde binnen de in-lijst (zelfde patroon als orders.ts).
    .not('status', 'in', `(${TERMINALE_STATUSSEN.map((s) => `"${s}"`).join(',')})`)
    .not('afleverdatum', 'is', null)

  if (error) throw error
  return (data ?? []) as MaatwerkHaalbaarheidRow[]
}

export interface InkoopRegelInfo {
  inkooporder_nr: string
  verwacht_datum: string | null
}

/** Lookup voor de stukken die op 'Wacht op inkoop' staan (mig 437/438) —
 *  toont aan de planner via welke inkooporder het stuk gedekt is. */
export async function fetchInkoopRegelInfo(regelIds: number[]): Promise<Map<number, InkoopRegelInfo>> {
  if (regelIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from('openstaande_inkooporder_regels')
    .select('regel_id, inkooporder_nr, verwacht_datum')
    .in('regel_id', regelIds)

  if (error) throw error
  return new Map(
    ((data ?? []) as Array<{ regel_id: number; inkooporder_nr: string; verwacht_datum: string | null }>).map(
      (r) => [r.regel_id, { inkooporder_nr: r.inkooporder_nr, verwacht_datum: r.verwacht_datum }],
    ),
  )
}
