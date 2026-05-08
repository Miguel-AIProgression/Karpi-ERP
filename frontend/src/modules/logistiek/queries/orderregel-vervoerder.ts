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
