// Bevestig-flow voor inkomende EDI-orders.
//
// Wordt aangeroepen vanaf de Bevestig-knop op de bericht-detail pagina. Stappen:
//   1. RPC `markeer_order_edi_bevestigd(order_id)` als idempotente gate.
//   2. Bouw orderbev-payload als TransusXML.
//   3. Insert/update in `edi_berichten` (richting='uit', status='Wachtrij').

import { supabase } from '@/lib/supabase/client'
import { isTestMessage, type OrderbevInput, type KarpiOrder } from './karpi-fixed-width'
import { bouwOrderbevXmlVoorBericht } from './download-orderbev-xml'

export interface BevestigResult {
  bevestigdOp: string
  uitgaandId: number
  payload: string
  /** True als de order al eerder was bevestigd (idempotent; geen nieuwe wachtrij-rij). */
  reedsEerderBevestigd: boolean
}

/**
 * Bevestig een EDI-order door de orderbev op de uitgaande wachtrij te plaatsen.
 *
 * @param orderId   Onze interne orders.id
 * @param berichtId edi_berichten.id van de inkomende order (bron-tracking)
 * @param parsedOrder  Geparseerde data uit het inkomende bericht
 * @param karpiGln  Onze eigen GLN als afzender van de orderbev
 */
export async function bevestigOrderViaEdi(
  orderId: number,
  berichtId: number,
  parsedOrder: KarpiOrder,
  karpiGln: string,
  options: { isTest?: boolean } = {},
): Promise<BevestigResult> {
  const { data: bevestigdOp, error: rpcErr } = await supabase.rpc('markeer_order_edi_bevestigd', {
    p_order_id: orderId,
  })
  if (rpcErr) throw rpcErr

  const isTest = options.isTest ?? isTestMessage(parsedOrder.header)
  const orderbevInput = buildOrderbevInput(parsedOrder, karpiGln, isTest)

  const { data: bestaand } = await supabase
    .from('edi_berichten')
    .select('id, payload_raw, status, order_response_seq')
    .eq('richting', 'uit')
    .eq('berichttype', 'orderbev')
    .eq('bron_tabel', 'orders')
    .eq('bron_id', orderId)
    .not('status', 'in', '("Fout","Geannuleerd")')
    .maybeSingle()

  if (bestaand?.id) {
    const bestaandRow = bestaand as {
      id: number
      payload_raw: string | null
      status: string
      order_response_seq: number | null
    }
    const heeftXml = bestaandRow.payload_raw?.trimStart().startsWith('<?xml') ?? false

    if (!heeftXml && bestaandRow.status === 'Wachtrij') {
      const xmlResult = await bouwOrderbevXmlVoorBericht(
        {
          id: bestaandRow.id,
          order_id: orderId,
          payload_parsed: orderbevInput as unknown as Record<string, unknown>,
          is_test: isTest,
          order_response_seq: bestaandRow.order_response_seq ?? 1,
        },
        { karpiGln },
      )

      const { error: updateErr } = await supabase
        .from('edi_berichten')
        .update({
          payload_raw: xmlResult.xml,
          payload_parsed: {
            format: 'transus_xml',
            source: orderbevInput,
            transus_xml: xmlResult.input,
          },
          order_response_seq: xmlResult.seq,
          is_test: isTest,
        })
        .eq('id', bestaandRow.id)
      if (updateErr) throw updateErr

      return {
        bevestigdOp: bevestigdOp as string,
        uitgaandId: bestaandRow.id,
        payload: xmlResult.xml,
        reedsEerderBevestigd: true,
      }
    }

    return {
      bevestigdOp: bevestigdOp as string,
      uitgaandId: bestaandRow.id,
      payload: bestaandRow.payload_raw ?? '',
      reedsEerderBevestigd: true,
    }
  }

  const seq = await bepaalVolgendeOrderResponseSeq(orderId)
  const xmlResult = await bouwOrderbevXmlVoorBericht(
    {
      id: 0,
      order_id: orderId,
      payload_parsed: orderbevInput as unknown as Record<string, unknown>,
      is_test: isTest,
      order_response_seq: seq,
    },
    { karpiGln },
  )

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
      payload_raw: xmlResult.xml,
      payload_parsed: {
        format: 'transus_xml',
        source: orderbevInput,
        transus_xml: xmlResult.input,
      },
      order_response_seq: seq,
      is_test: isTest,
    })
    .select('id')
    .single()
  if (outErr) throw outErr

  await supabase.from('edi_berichten').update({ order_id: orderId }).eq('id', berichtId)

  return {
    bevestigdOp: bevestigdOp as string,
    uitgaandId: outRow.id,
    payload: xmlResult.xml,
    reedsEerderBevestigd: false,
  }
}

function buildOrderbevInput(
  parsedOrder: KarpiOrder,
  karpiGln: string,
  isTest: boolean,
): OrderbevInput {
  return {
    ordernummer: parsedOrder.header.ordernummer,
    leverdatum: parsedOrder.header.leverdatum,
    orderdatum: new Date().toISOString().slice(0, 10),
    afnemer_naam: parsedOrder.header.afnemer_naam,
    gln_gefactureerd: parsedOrder.header.gln_gefactureerd ?? '',
    gln_besteller: parsedOrder.header.gln_besteller ?? '',
    gln_afleveradres: parsedOrder.header.gln_afleveradres ?? '',
    gln_leverancier: karpiGln,
    is_test: isTest,
    regels: parsedOrder.regels.map((r) => ({
      regelnummer: r.regelnummer,
      gtin: r.gtin,
      artikelcode: r.artikelcode,
      aantal: r.aantal,
      ordernummer_ref: parsedOrder.header.ordernummer,
    })),
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

async function bepaalVolgendeOrderResponseSeq(orderId: number): Promise<number> {
  const { data, error } = await supabase
    .from('edi_berichten')
    .select('order_response_seq')
    .eq('richting', 'uit')
    .eq('berichttype', 'orderbev')
    .eq('order_id', orderId)
    .order('order_response_seq', { ascending: false, nullsFirst: false })
    .limit(1)
  if (error) throw error

  const row = (data?.[0] ?? null) as { order_response_seq: number | null } | null
  return (row?.order_response_seq ?? 0) + 1
}
