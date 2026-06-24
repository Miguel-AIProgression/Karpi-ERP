import { supabase } from '@/lib/supabase/client'

/**
 * Order_events query-laag (ADR-0006). Tabel `order_events` heeft kolommen:
 *   id, order_id, event_type, status_voor, status_na, actor_*, reden, metadata, created_at.
 * Het `metadata`-veld is JSONB en bevat per event-type een ander payload-schema.
 * We modelleren bekende event-types als een discriminated union; onbekende
 * toekomstige waarden landen in de 'overig'-tak zonder crash (string & {} vangnet).
 */

/** Bekende event-types — uitgebreid in mig 503 met handmatige acties. */
export type OrderEventType =
  | 'aangemaakt'
  | 'pickronde_gestart'
  | 'pickronde_voltooid'
  | 'pickronde_teruggedraaid'
  | 'deels_verzonden'
  | 'wacht_status_herberekend'
  | 'geannuleerd'
  | 'backfill_fase_normalisatie'
  | 'prijs_geaccepteerd'
  | 'deelzending_gestart'
  | 'maatwerk_afgerond'
  | 'levertijd_gewijzigd_door_eta'
  | 'claim_geswapt_weg'
  | 'claim_geswapt_naar'
  | 'deadline_conflict_na_swap'
  // mig 503 — actor-email in metadata.gedaan_door
  | 'orderbevestiging_verstuurd'
  | 'creditfactuur_aangemaakt'
  | 'order_gewijzigd'
  // Vangnet: string & {} staat narrowing toe op de specifiek genoemde literals;
  // onbekende toekomstige DB-waarden landen in de 'overig'-tak van OrderEvent.
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {})

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

/** Metadata-payload bij 'orderbevestiging_verstuurd' (mig 503). */
export interface OrderbevestigingVerstuurdMetadata {
  email_naar: string
  gedaan_door: string
}

/** Metadata-payload bij 'creditfactuur_aangemaakt' (mig 503). */
export interface CreditfactuurAangemaaktMetadata {
  creditfactuur_id: number
  creditfactuur_nr: string
  originele_factuur_nr: string
  reden: string | null
  gedaan_door: string | null
}

/** Metadata-payload bij 'order_gewijzigd' (mig 503). */
export interface OrderGewijzigdMetadata {
  oud_bedrag: number | null
  nieuw_bedrag: number | null
  gedaan_door: string | null
}

interface BaseOrderEvent {
  id: number
  order_id: number
  status_voor: string | null
  status_na: string
  reden: string | null
  created_at: string
}

/** Discriminated union — switch op `event_type` voor type-narrowing van `metadata`. */
export type OrderEvent =
  | (BaseOrderEvent & { event_type: 'claim_geswapt_weg'; metadata: ClaimGeswaptWegMetadata })
  | (BaseOrderEvent & { event_type: 'claim_geswapt_naar'; metadata: ClaimGeswaptNaarMetadata })
  | (BaseOrderEvent & { event_type: 'deadline_conflict_na_swap'; metadata: DeadlineConflictNaSwapMetadata })
  | (BaseOrderEvent & { event_type: 'orderbevestiging_verstuurd'; metadata: OrderbevestigingVerstuurdMetadata })
  | (BaseOrderEvent & { event_type: 'creditfactuur_aangemaakt'; metadata: CreditfactuurAangemaaktMetadata })
  | (BaseOrderEvent & { event_type: 'order_gewijzigd'; metadata: OrderGewijzigdMetadata })
  | (BaseOrderEvent & { event_type: string; metadata: Record<string, unknown> | null })

export async function fetchOrderEvents(orderId: number): Promise<OrderEvent[]> {
  const { data, error } = await supabase
    .from('order_events')
    .select('id, order_id, event_type, status_voor, status_na, reden, metadata, created_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as OrderEvent[]
}
