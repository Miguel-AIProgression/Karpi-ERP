import { supabase } from '@/lib/supabase/client'

/**
 * Order_events query-laag (ADR-0006). Tabel `order_events` heeft kolommen:
 *   id, order_id, event_type, status_voor, status_na, actor_*, reden, metadata, created_at.
 * Het `metadata`-veld is JSONB en bevat per event-type een ander payload-schema.
 * We modelleren de bekende event-types als een discriminated union zodat
 * consumers (UI) type-veilig per type kunnen renderen, en vallen voor onbekende
 * waardes terug op een 'overig' tak (geen crash bij nieuwe enum-waarden).
 *
 * NB: ADR-0027 Stap 2/3 (mig 297/298) introduceert drie nieuwe enum-waarden —
 * 'claim_geswapt_weg', 'claim_geswapt_naar' en 'deadline_conflict_na_swap'.
 * De render-laag is hier al voorbereid.
 */

/** Bekende event-types uit mig 218 + mig 257 + ADR-0027 Stap 2/3. */
export type OrderEventType =
  | 'aangemaakt'
  | 'pickronde_gestart'
  | 'pickronde_voltooid'
  | 'deels_verzonden'
  | 'wacht_status_herberekend'
  | 'geannuleerd'
  | 'backfill_fase_normalisatie'
  | 'claim_geswapt_weg'
  | 'claim_geswapt_naar'
  | 'deadline_conflict_na_swap'

/** Metadata-payload bij 'claim_geswapt_weg' (op de bron-order — die voorraad afstaat). */
export interface ClaimGeswaptWegMetadata {
  naar_order_id: number
  orderregel_id: number
  aantal: number
  oude_bron: string
  nieuwe_bron: string
  io_regel_id: number | null
  fysiek_artikelnr: string | null
}

/** Metadata-payload bij 'claim_geswapt_naar' (op de doel-order — die voorraad ontvangt). */
export interface ClaimGeswaptNaarMetadata {
  van_order_id: number
  orderregel_id: number
  aantal: number
  bron: string
  fysiek_artikelnr: string | null
}

/** Metadata-payload bij 'deadline_conflict_na_swap'. */
export interface DeadlineConflictNaSwapMetadata {
  oude_afleverdatum: string | null
  nieuwe_afleverdatum: string | null
  standaard: string | null
}

interface BaseOrderEvent {
  id: number
  order_id: number
  status_voor: string | null
  status_na: string
  reden: string | null
  created_at: string
}

/** Discriminated union — switch op `event_type` voor type-narrowing van `metadata`.
 *  Geen catch-all `event_type: string`-tak: die zou een supertype van de literals zijn
 *  en narrowing breken (TS infereert `metadata` dan als `Record<string, unknown> | null`
 *  ook in de specifieke takken). Nieuwe DB-event-types moeten in `OrderEventType`. */
export type OrderEvent =
  | (BaseOrderEvent & { event_type: 'claim_geswapt_weg'; metadata: ClaimGeswaptWegMetadata })
  | (BaseOrderEvent & { event_type: 'claim_geswapt_naar'; metadata: ClaimGeswaptNaarMetadata })
  | (BaseOrderEvent & { event_type: 'deadline_conflict_na_swap'; metadata: DeadlineConflictNaSwapMetadata })
  | (BaseOrderEvent & {
      event_type: Exclude<
        OrderEventType,
        'claim_geswapt_weg' | 'claim_geswapt_naar' | 'deadline_conflict_na_swap'
      >
      metadata: Record<string, unknown> | null
    })

export async function fetchOrderEvents(orderId: number): Promise<OrderEvent[]> {
  const { data, error } = await supabase
    .from('order_events')
    .select('id, order_id, event_type, status_voor, status_na, reden, metadata, created_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as OrderEvent[]
}
