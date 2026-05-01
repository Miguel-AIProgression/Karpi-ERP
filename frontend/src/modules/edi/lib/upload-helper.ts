// Upload-helper voor handmatige round-trip-tests met echte Transus-bestanden.
//
// In tegenstelling tot demo-helper (hardcoded templates) accepteert deze helper een
// `.inh`/`.txt`-bestand dat de gebruiker uit Transus Online's archief heeft
// gedownload. De parser, debiteur-match en order-creatie-flow zijn identiek aan
// de demo-flow — het enige verschil zit in de bron van de payload.
//
// Plan: docs/superpowers/plans/2026-04-30-edi-handmatige-upload-download.md

import { supabase } from '@/lib/supabase/client'
import { parseKarpiOrder, type KarpiOrder } from './karpi-fixed-width'
import { herprijsEdiOrderUitPrijslijst, zoekDebiteurOpGln } from './pricing-helper'

export interface UploadResult {
  inkomendId: number
  inkomendPayload: string
  parsed: KarpiOrder
  orderId: number | null
  orderSkippedReason?: string
  /** True als dit bestand al eerder is geüpload (zelfde payload-hash). */
  reedsBekend: boolean
}

export interface UploadOptions {
  karpiGln?: string
  /** Forceer dat upload als nieuw bericht wordt opgeslagen, zelfs bij dubbele payload-hash. */
  forceerNieuw?: boolean
}

const KARPI_GLN_DEFAULT = '8715954999998'

/**
 * Verwerk een uit Transus gedownload `.inh`-bestand alsof het via M10110 is binnengekomen.
 *
 * Stappen:
 *   1. Lees bestand als UTF-8 string.
 *   2. Sanity-check: minimaal 463 bytes (header), eerste byte '0'.
 *   3. parseKarpiOrder → throw bij fout.
 *   4. SHA-256 hash → transactie_id `UPLOAD-{first12chars}`.
 *   5. Check op bestaande transactie_id; bij hit (en niet forceerNieuw) → return existing.
 *   6. Match debiteur op gln_gefactureerd / gln_besteller.
 *   7. Insert in edi_berichten (richting='in', status='Verwerkt', is_test=true).
 *   8. Roep create_edi_order RPC aan.
 *   9. Retourneer resultaat met links voor UI.
 */
export async function verwerkUploadInkomend(
  file: File,
  options: UploadOptions = {},
): Promise<UploadResult> {
  const karpiGln = options.karpiGln ?? KARPI_GLN_DEFAULT

  const raw = await file.text()
  if (raw.length < 463) {
    throw new Error(
      `Bestand te kort: ${raw.length} bytes — verwacht minimaal 463 bytes voor een Karpi-fixed-width header.`,
    )
  }
  if (raw[0] !== '0') {
    throw new Error(
      `Eerste karakter is '${raw[0]}', verwacht '0' (record-type header). ` +
        `Is dit wel een Karpi-fixed-width \`.inh\`-bestand?`,
    )
  }

  const parsed = parseKarpiOrder(raw, { karpiGln })

  const hash = await sha256Hex(raw)
  const baseTransactieId = `UPLOAD-${hash.slice(0, 12)}`
  const transactieId = options.forceerNieuw
    ? `${baseTransactieId}-${Date.now()}`
    : baseTransactieId

  if (!options.forceerNieuw) {
    const { data: bestaand } = await supabase
      .from('edi_berichten')
      .select('id, payload_raw, order_id')
      .eq('transactie_id', baseTransactieId)
      .maybeSingle()

    if (bestaand) {
      return {
        inkomendId: bestaand.id,
        inkomendPayload: bestaand.payload_raw ?? raw,
        parsed,
        orderId: bestaand.order_id ?? null,
        reedsBekend: true,
      }
    }
  }

  const debiteurNr = await zoekDebiteurOpGln([
    parsed.header.gln_gefactureerd,
    parsed.header.gln_besteller,
  ])

  const { data: inRow, error: inErr } = await supabase
    .from('edi_berichten')
    .insert({
      richting: 'in',
      berichttype: 'order',
      status: 'Verwerkt',
      transactie_id: transactieId,
      debiteur_nr: debiteurNr,
      payload_raw: raw,
      payload_parsed: parsed as unknown as Record<string, unknown>,
      is_test: true,
      sent_at: new Date().toISOString(),
      ack_status: 0,
      acked_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (inErr) throw inErr

  if (!debiteurNr) {
    return {
      inkomendId: inRow.id,
      inkomendPayload: raw,
      parsed,
      orderId: null,
      orderSkippedReason: `Geen debiteur gevonden met GLN ${parsed.header.gln_gefactureerd ?? parsed.header.gln_besteller ?? '(leeg)'}. Voeg de GLN toe aan een debiteur voordat je opnieuw uploadt.`,
      reedsBekend: false,
    }
  }

  const { data: orderId, error: rpcErr } = await supabase.rpc('create_edi_order', {
    p_inkomend_bericht_id: inRow.id,
    p_payload_parsed: parsed,
    p_debiteur_nr: debiteurNr,
  })
  if (rpcErr) {
    return {
      inkomendId: inRow.id,
      inkomendPayload: raw,
      parsed,
      orderId: null,
      orderSkippedReason: `create_edi_order faalde: ${rpcErr.message}`,
      reedsBekend: false,
    }
  }
  await herprijsEdiOrderUitPrijslijst(orderId as number)

  return {
    inkomendId: inRow.id,
    inkomendPayload: raw,
    parsed,
    orderId: orderId as number,
    reedsBekend: false,
  }
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', enc)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
