// Bevestig-flow voor inkomende EDI-orders.
//
// Wordt aangeroepen vanaf de Bevestig-knop op de bericht-detail pagina (en later
// ook vanuit een trigger op orders-status). Stappen:
//   1. RPC `markeer_order_edi_bevestigd(order_id)` — idempotente gate
//   2. Bouw orderbev-payload via `buildKarpiOrderbev`
//   3. Insert in `edi_berichten` (richting='uit', status='Wachtrij')
//
// LET OP: het orderbev-formaat is op 2026-04-29 nog gebaseerd op een werkhypothese
// (zelfde 463+281 fixed-width als inkomende order). Transus' Testen-tab voor
// "Orderbevestiging versturen" zal dit waarschijnlijk afkeuren totdat we de echte
// berichtspecificatie van Maureen hebben en de builder herschrijven.

import { supabase } from '../supabase/client'
import { buildKarpiOrderbev, type OrderbevInput, type KarpiOrder } from './karpi-fixed-width'

export interface BevestigResult {
  bevestigdOp: string
  uitgaandId: number
  payload: string
  /** True als de order al eerder was bevestigd (idempotent — geen nieuwe payload gegenereerd). */
  reedsEerderBevestigd: boolean
}

/**
 * Bevestig een EDI-order door de orderbev op de uitgaande wachtrij te plaatsen.
 *
 * @param orderId   Onze interne orders.id
 * @param berichtId edi_berichten.id van de inkomende order (bron-tracking)
 * @param parsedOrder  Geparseerde data uit het inkomende bericht — gebruikt om
 *                     de orderbev-payload te bouwen (GLN's, regels, etc.)
 * @param karpiGln  Onze eigen GLN als afzender van de orderbev
 */
export async function bevestigOrderViaEdi(
  orderId: number,
  berichtId: number,
  parsedOrder: KarpiOrder,
  karpiGln: string,
): Promise<BevestigResult> {
  // 1. Markeer order als bevestigd (idempotent)
  const { data: bevestigdOp, error: rpcErr } = await supabase.rpc('markeer_order_edi_bevestigd', {
    p_order_id: orderId,
  })
  if (rpcErr) throw rpcErr

  // 2. Check of er al een uitgaand orderbev-bericht bestaat voor deze order — dan
  //    geen nieuwe genereren (komt voor wanneer gebruiker dubbel klikt of een
  //    eerdere bevestiging is mislukt en gerestart wordt)
  const { data: bestaand } = await supabase
    .from('edi_berichten')
    .select('id, payload_raw')
    .eq('richting', 'uit')
    .eq('berichttype', 'orderbev')
    .eq('bron_tabel', 'orders')
    .eq('bron_id', orderId)
    .not('status', 'in', '("Fout","Geannuleerd")')
    .maybeSingle()

  if (bestaand?.id) {
    return {
      bevestigdOp: bevestigdOp as string,
      uitgaandId: bestaand.id,
      payload: bestaand.payload_raw ?? '',
      reedsEerderBevestigd: true,
    }
  }

  // 3. Build orderbev-payload op basis van de geparseerde order
  const orderbevInput: OrderbevInput = {
    ordernummer: parsedOrder.header.ordernummer,
    leverdatum: parsedOrder.header.leverdatum,
    orderdatum: new Date().toISOString().slice(0, 10),
    afnemer_naam: parsedOrder.header.afnemer_naam,
    gln_gefactureerd: parsedOrder.header.gln_gefactureerd ?? '',
    gln_besteller: parsedOrder.header.gln_besteller ?? '',
    gln_afleveradres: parsedOrder.header.gln_afleveradres ?? '',
    gln_leverancier: karpiGln,
    is_test: true, // demo-flow → altijd test-marker
    regels: parsedOrder.regels.map((r) => ({
      regelnummer: r.regelnummer,
      gtin: r.gtin,
      artikelcode: r.artikelcode,
      aantal: r.aantal,
      ordernummer_ref: parsedOrder.header.ordernummer,
    })),
  }
  const payload = buildKarpiOrderbev(orderbevInput)

  // 4. Insert in uitgaande wachtrij
  const { data: outRow, error: outErr } = await supabase
    .from('edi_berichten')
    .insert({
      richting: 'uit',
      berichttype: 'orderbev',
      status: 'Wachtrij',
      debiteur_nr: await zoekDebiteurOpOrder(orderId),
      order_id: orderId,
      bron_tabel: 'orders',
      bron_id: orderId,
      payload_raw: payload,
      payload_parsed: orderbevInput as unknown as Record<string, unknown>,
      is_test: true,
    })
    .select('id')
    .single()
  if (outErr) throw outErr

  // Onderhoud: koppel ook de inkomende-bericht-rij voor traceerbaarheid (nuttig
  // wanneer order_id niet eerder was gezet via create_edi_order's UPDATE)
  await supabase.from('edi_berichten').update({ order_id: orderId }).eq('id', berichtId)

  return {
    bevestigdOp: bevestigdOp as string,
    uitgaandId: outRow.id,
    payload,
    reedsEerderBevestigd: false,
  }
}

async function zoekDebiteurOpOrder(orderId: number): Promise<number | null> {
  const { data } = await supabase
    .from('orders')
    .select('debiteur_nr')
    .eq('id', orderId)
    .maybeSingle()
  return data?.debiteur_nr ?? null
}
