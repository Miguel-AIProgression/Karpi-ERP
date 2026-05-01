// Demo-helper voor de EDI-flow zonder echte Transus-API.
//
// Genereert een fictieve inkomende order: insert in `edi_berichten` (richting=in)
// + roept `create_edi_order` RPC aan zodat er een echte order in `orders` ontstaat.
// Daarna kan de gebruiker via de UI "Bevestigen" klikken om de orderbev op de
// uitgaande wachtrij te zetten — zie `bevestig-helper.ts`.
//
// Geen Transus API-calls — pure simulatie.

import { supabase } from '@/lib/supabase/client'
import {
  parseKarpiOrder,
  buildKarpiOrderbev,
  type KarpiOrder,
  type OrderbevInput,
} from './karpi-fixed-width'
import { herprijsEdiOrderUitPrijslijst, zoekDebiteurOpGln } from './pricing-helper'

export type DemoTemplate = 'bdsk-sparse' | 'ostermann-rich'

export interface DemoResult {
  inkomendId: number
  inkomendPayload: string
  orderId: number | null
  /** Reden waarom create_edi_order overgeslagen is (bv. geen debiteur-match). */
  orderSkippedReason?: string
}

/**
 * Maak een demo-rondreis aan: 1 fictief inkomend ordersbericht, en als we de
 * debiteur op GLN kunnen matchen meteen een echte order in `orders`. Beide
 * rijen worden gemarkeerd als `is_test=true` zodat ze later eenvoudig op te
 * ruimen zijn.
 */
export async function genereerDemoBerichten(
  template: DemoTemplate,
  options: { karpiGln: string; ordernummerSuffix?: string } = { karpiGln: '8715954999998' },
): Promise<DemoResult> {
  const { rawIn, parsedIn } = bouwInkomendeOrder(template, options)

  const transactieId = `DEMO-${Date.now()}`
  const debiteurNr = await zoekDebiteurOpGln([
    parsedIn.header.gln_gefactureerd,
    parsedIn.header.gln_besteller,
  ])

  // 1. Inkomend bericht loggen — status='Verwerkt' want simulatie heeft 'm al ge-ackt
  const { data: inRow, error: inErr } = await supabase
    .from('edi_berichten')
    .insert({
      richting: 'in',
      berichttype: 'order',
      status: 'Verwerkt',
      transactie_id: transactieId,
      debiteur_nr: debiteurNr,
      payload_raw: rawIn,
      payload_parsed: parsedIn as unknown as Record<string, unknown>,
      is_test: true,
      sent_at: new Date().toISOString(),
      ack_status: 0,
      acked_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (inErr) throw inErr

  // 2. Order aanmaken via RPC — alleen als debiteur bekend is. Zonder debiteur kan
  //    de order toch worden aangemaakt (debiteur_nr=NULL is technisch toegestaan)
  //    maar dat heeft geen praktische waarde voor de demo.
  if (!debiteurNr) {
    return {
      inkomendId: inRow.id,
      inkomendPayload: rawIn,
      orderId: null,
      orderSkippedReason: `Geen debiteur gevonden met GLN ${parsedIn.header.gln_gefactureerd ?? parsedIn.header.gln_besteller ?? '(leeg)'}. Voeg de GLN toe aan een debiteur of activeer EDI op een bestaande klant.`,
    }
  }

  const { data: orderId, error: rpcErr } = await supabase.rpc('create_edi_order', {
    p_inkomend_bericht_id: inRow.id,
    p_payload_parsed: parsedIn,
    p_debiteur_nr: debiteurNr,
  })
  if (rpcErr) {
    return {
      inkomendId: inRow.id,
      inkomendPayload: rawIn,
      orderId: null,
      orderSkippedReason: `create_edi_order faalde: ${rpcErr.message}`,
    }
  }
  await herprijsEdiOrderUitPrijslijst(orderId as number)

  return {
    inkomendId: inRow.id,
    inkomendPayload: rawIn,
    orderId: orderId as number,
  }
}

function bouwInkomendeOrder(
  template: DemoTemplate,
  options: { karpiGln: string; ordernummerSuffix?: string },
): { rawIn: string; parsedIn: KarpiOrder } {
  const suffix = options.ordernummerSuffix ?? Date.now().toString(36).toUpperCase().slice(-4)

  const rawIn =
    template === 'bdsk-sparse'
      ? bouwBdskTemplate(options.karpiGln, `DEMO${suffix}`)
      : bouwOstermannTemplate(options.karpiGln, `DEMO${suffix}`)
  const parsedIn = parseKarpiOrder(rawIn, { karpiGln: options.karpiGln })
  return { rawIn, parsedIn }
}

function bouwBdskTemplate(karpiGln: string, ordernr: string): string {
  // Hergebruikt de orderbev-builder (zelfde header+article-template) om een
  // fictieve "inkomende" order te produceren in het Karpi-fixed-width-format.
  const input: OrderbevInput = {
    ordernummer: ordernr,
    leverdatum: addDaysIso(new Date(), 25),
    orderdatum: new Date().toISOString().slice(0, 10),
    afnemer_naam: null,
    gln_gefactureerd: '9007019015989', // BDSK HQ Würzburg
    gln_besteller: '9009852030365',    // XXXLUTZ Wuerselen
    gln_afleveradres: '9009852030365',
    gln_leverancier: karpiGln,
    is_test: true,
    regels: [
      {
        regelnummer: 1,
        gtin: '8715954176047',
        artikelcode: 'PATCH',
        aantal: 1,
        ordernummer_ref: ordernr,
      },
    ],
  }
  return buildKarpiOrderbev(input)
}

function bouwOstermannTemplate(karpiGln: string, ordernr: string): string {
  const input: OrderbevInput = {
    ordernummer: ordernr,
    leverdatum: null,
    orderdatum: new Date().toISOString().slice(0, 10),
    afnemer_naam: 'Demo Ostermann',
    gln_gefactureerd: '4260217580016', // Ostermann HQ Witten
    gln_besteller: '4260217580146',    // Filiaal Leverkusen
    gln_afleveradres: '4260217580146',
    gln_leverancier: karpiGln,
    is_test: true,
    regels: [
      {
        regelnummer: 1000,
        gtin: '8715954211625',
        artikelcode: '526650044 155x230',
        aantal: 1,
        ordernummer_ref: ordernr,
      },
      {
        regelnummer: 2000,
        gtin: '8715954211649',
        artikelcode: '526650046 rund 160',
        aantal: 1,
        ordernummer_ref: ordernr,
      },
      {
        regelnummer: 3000,
        gtin: '8715954223857',
        artikelcode: '526920037',
        aantal: 2,
        ordernummer_ref: ordernr,
      },
    ],
  }
  return buildKarpiOrderbev(input)
}

function addDaysIso(date: Date, days: number): string {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
