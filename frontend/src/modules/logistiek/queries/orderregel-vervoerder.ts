import { supabase } from '@/lib/supabase/client'

/**
 * Per-orderregel vervoerder-resolver (mig 219, versimpeld in mig 225).
 *
 * Returnt voor elke pickbare regel van een order welke vervoerder uiteindelijk
 * geldt en waarom. Bron-precedentie (3-niveau ladder, ADR-0008):
 *   1. override  — handmatige override op order_regels.vervoerder_code
 *   2. regel     — verzendregel-evaluator (vervoerder_selectie_regels)
 *   3. geen      — geen matchende regel gevonden
 * Afhalen-orders returnen bron='afhalen' (geen vervoerder, ongeacht overrides).
 *
 * Klant-fallback (edi_handelspartner_config.vervoerder_code) bestaat niet meer
 * als aparte ladder-bron — bestaande klant-keuzes zijn gemigreerd naar
 * vervoerder_selectie_regels (mig 224, prio 9000).
 */
export interface OrderregelVervoerder {
  orderregel_id: number
  /** Handmatige override op order_regels.vervoerder_code (NULL = geen override). */
  override_code: string | null
  /** Vervoerder die de verzendregel-evaluator zou kiezen op per-regel attributen. */
  evaluator_code: string | null
  evaluator_service: string | null
  /** Effectieve keuze die de zending-aanmaak gebruikt. */
  effectief_code: string | null
  effectief_service: string | null
  /** Bron van de effectieve keuze: 'override' | 'regel' | 'geen' | 'afhalen' */
  bron: 'override' | 'regel' | 'geen' | 'afhalen'
  /** TRUE = er bestaat al een zending_regel voor deze orderregel; UPDATE op
   *  `vervoerder_code` zou door de lock-trigger geweigerd worden. UI moet de
   *  pill als locked tonen. Mig 221. */
  is_locked: boolean
  uitleg: Record<string, unknown> | null
}

export async function fetchEffectieveVervoerderPerOrderregel(
  orderId: number,
): Promise<OrderregelVervoerder[]> {
  const { data, error } = await supabase.rpc('effectieve_vervoerder_per_orderregel', {
    p_order_id: orderId,
  })
  if (error) throw error
  return (data ?? []) as OrderregelVervoerder[]
}

/** Batch-rij = OrderregelVervoerder + het order_id waartoe de regel hoort. */
export interface OrderregelVervoerderMetOrder extends OrderregelVervoerder {
  order_id: number
}

/**
 * Batch-resolver (mig 401): haalt de effectieve vervoerder voor álle
 * meegegeven orders in ÉÉN RPC-call op en groepeert per order_id.
 *
 * Vervangt het N+1-patroon op Pick & Ship (één `effectieve_vervoerder_per_orderregel`
 * per order-card → N losse HTTP-calls). De DB-functie is een dunne LATERAL-wrapper
 * over de per-order-resolver, dus de per-regel-shape is identiek — alleen de
 * `order_id`-prefix is extra. Orders zonder regels (of onbekende ids) verschijnen
 * niet in de Map; consumers behandelen "ontbrekend" als lege regel-lijst.
 */
export async function fetchEffectieveVervoerderVoorOrders(
  orderIds: number[],
): Promise<Map<number, OrderregelVervoerder[]>> {
  const map = new Map<number, OrderregelVervoerder[]>()
  if (orderIds.length === 0) return map
  const { data, error } = await supabase.rpc('effectieve_vervoerder_voor_orders', {
    p_order_ids: orderIds,
  })
  if (error) throw error
  for (const rij of (data ?? []) as OrderregelVervoerderMetOrder[]) {
    const { order_id, ...regel } = rij
    const lijst = map.get(order_id)
    if (lijst) lijst.push(regel)
    else map.set(order_id, [regel])
  }
  return map
}

/**
 * Zet de override-vervoerder op een orderregel (NULL = override verwijderen,
 * dan vallen we terug op evaluator/klant-fallback).
 *
 * DB-trigger `trg_lock_orderregel_vervoerder` (mig 219) blokkeert wijzigingen
 * zodra er een open zending voor de regel bestaat. Faalt dan met een
 * `restrict_violation`-fout die de UI kan tonen.
 */
export async function updateOrderregelVervoerderOverride(
  orderregelId: number,
  vervoerderCode: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('order_regels')
    .update({ vervoerder_code: vervoerderCode })
    .eq('id', orderregelId)
  if (error) {
    // Supabase PostgrestError is een plain object — gooien we als Error met
    // alle nuttige velden in de message zodat de UI de echte reden toont
    // (RLS-block, lock-trigger, FK-violation, etc.).
    const parts = [error.message, error.details, error.hint, error.code]
      .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    throw new Error(
      parts.length > 0 ? parts.join(' · ') : 'Wijzigen vervoerder mislukt',
    )
  }
}
