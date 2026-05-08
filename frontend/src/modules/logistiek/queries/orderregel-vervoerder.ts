import { supabase } from '@/lib/supabase/client'

/**
 * Per-orderregel vervoerder-resolver (mig 219).
 *
 * Returnt voor elke pickbare regel van een order welke vervoerder uiteindelijk
 * geldt en waarom. Bron-precedentie: override > regel > klant_fallback > geen.
 */
export interface OrderregelVervoerder {
  orderregel_id: number
  /** Handmatige override op order_regels.vervoerder_code (NULL = geen override). */
  override_code: string | null
  /** Vervoerder die de verzendregel-evaluator zou kiezen op per-regel attributen. */
  evaluator_code: string | null
  evaluator_service: string | null
  /** edi_handelspartner_config.vervoerder_code voor de debiteur. */
  klant_fallback_code: string | null
  /** Effectieve keuze die de zending-aanmaak gebruikt. */
  effectief_code: string | null
  effectief_service: string | null
  /** 'override' | 'regel' | 'klant_fallback' | 'geen' | 'afhalen' */
  bron: 'override' | 'regel' | 'klant_fallback' | 'geen' | 'afhalen'
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
