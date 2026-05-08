// frontend/src/modules/logistiek/queries/vervoerder-keuze.ts
import { supabase } from '@/lib/supabase/client'
import type { OrderregelVervoerder } from './orderregel-vervoerder'

export interface BulkOverrideResultaat {
  orderregel_id: number | null
  resultaat: 'gezet' | 'geblokkeerd_door_zending' | 'overgeslagen_afhalen'
  reden: string | null
}

/**
 * Zet de override-vervoerder op alle regels van een order in één transactie.
 * NULL als `vervoerderCode` wist de override (terug naar regel-evaluator).
 *
 * Returnt per regel of het gelukt is. Geblokkeerde regels (al in een open
 * zending) komen terug als `resultaat='geblokkeerd_door_zending'` — geen
 * exception. UI moet die rijen aan de operator tonen.
 */
export async function setOrderVervoerderOverride(
  orderId: number,
  vervoerderCode: string | null,
): Promise<BulkOverrideResultaat[]> {
  const { data, error } = await supabase.rpc('set_orderregel_vervoerder_override_voor_order', {
    p_order_id: orderId,
    p_vervoerder_code: vervoerderCode,
  })
  if (error) {
    // Wrap PostgrestError → Error met message+details+hint+code samengevoegd, zelfde
    // patroon als updateOrderregelVervoerderOverride. UI-foutbanner krijgt de echte
    // reden (RLS-block, FK-violation, restrict_violation) i.p.v. een raw object.
    const parts = [error.message, error.details, error.hint, error.code]
      .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    throw new Error(
      parts.length > 0 ? parts.join(' · ') : 'Vervoerder voor order instellen mislukt',
    )
  }
  return (data ?? []) as BulkOverrideResultaat[]
}

/**
 * Aggregatie-helper: leid de order-niveau "vervoerder-keuze" af uit de
 * per-orderregel-uitkomsten. Pure functie — testbaar zonder DB.
 *
 * - Alle regels gelijk (incl. NULL → NULL) → `'uniform'` met die code
 * - Mix van codes (incl. NULL) → `'mix'` met de unieke codes erbij (gesorteerd)
 * - Geen regels → `'leeg'`
 *
 * **Let op `bron` bij `'uniform'`:** wordt overgenomen van de eerste regel.
 * Twee regels met dezelfde `effectief_code` maar verschillende `bron`
 * (bv. één 'override', één 'regel') leveren `'uniform'` op met de bron van
 * regel-0 — dat is misleidend maar acceptabel voor V1 omdat de UI alleen het
 * label-icoon (sparkles voor 'regel', truck voor 'override') ervan afleidt.
 */
export type OrderVervoerderAggregaat =
  | { soort: 'leeg' }
  | { soort: 'uniform'; code: string | null; bron: OrderregelVervoerder['bron'] }
  | { soort: 'mix'; codes: Array<string | null> }

export function aggregeerVervoerderKeuzeVoorOrder(
  perRegel: OrderregelVervoerder[],
): OrderVervoerderAggregaat {
  if (perRegel.length === 0) return { soort: 'leeg' }
  const codes = Array.from(new Set(perRegel.map((r) => r.effectief_code)))
  if (codes.length === 1) {
    return { soort: 'uniform', code: codes[0], bron: perRegel[0].bron }
  }
  // Deterministische volgorde voor UI-label "Mix · DPD+UPS" — null sorteert achteraan.
  codes.sort((a, b) => (a ?? '￿').localeCompare(b ?? '￿'))
  return { soort: 'mix', codes }
}
