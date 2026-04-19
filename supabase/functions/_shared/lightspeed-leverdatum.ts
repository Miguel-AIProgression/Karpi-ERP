// Bepaal de afleverdatum van een Lightspeed-order voor RugFlow.
//
// Bron-volgorde:
//   1. `deliveryDate` (native Lightspeed veld) — zelden gevuld.
//   2. `shipmentTitle` — vrije tekst met leverdatum, per verzendmethode
//      verschillend. Floorpassion gebruikt o.a.:
//        NL: "Bezorging op woensdag 22 april"
//            "Express levering — uiterlijk 22 april geleverd."
//            "Levering binnen 4 – 8 weken"
//        DE: "Versandfertig innerhalb von 2 Wochen"
//            "Versandfertig in 2 Arbeitstagen"
//   3. Fallback: orderdatum + debiteur.maatwerk_weken × 7 dagen.
//
// Alle resultaten worden naar de eerstvolgende werkdag geschoven (ma-vr).

import { naarWerkdag, plusKalenderDagen } from './levertijd-match.ts'

const MAANDEN_NL: Record<string, number> = {
  januari: 1, februari: 2, maart: 3, april: 4, mei: 5, juni: 6,
  juli: 7, augustus: 8, september: 9, oktober: 10, november: 11, december: 12,
  jan: 1, feb: 2, mrt: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9,
  okt: 10, nov: 11, dec: 12,
}

const MAANDEN_DE: Record<string, number> = {
  januar: 1, februar: 2, märz: 3, maerz: 3, april: 4, mai: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
}

interface LightspeedOrderForDate {
  createdAt?: string | null
  shipmentTitle?: string | null
  deliveryDate?: string | null
}

/**
 * Parseer "DD maand" uit vrije tekst. Retourneert ISO-datum of null.
 * Jaar wordt afgeleid: we nemen de eerstvolgende datum in de toekomst vanaf
 * `basisDatum` — zo valt "22 april" in 2027 als we ver na die datum zitten.
 */
function parseDagMaand(tekst: string, basisDatum: Date): string | null {
  const lc = tekst.toLowerCase()
  const maanden = { ...MAANDEN_NL, ...MAANDEN_DE }
  // DD (punt-suffix optioneel voor DE) maandNaam
  const regex = /(\d{1,2})\.?\s+([a-zäöüß]+)/gi
  let m: RegExpExecArray | null
  while ((m = regex.exec(lc)) !== null) {
    const dag = parseInt(m[1], 10)
    const maandNaam = m[2].replace(/[.,]/g, '')
    const maand = maanden[maandNaam]
    if (!maand) continue
    if (dag < 1 || dag > 31) continue
    // Pak het eerstvolgende jaar waarin DD-MM ≥ basisDatum ligt.
    const basisJaar = basisDatum.getUTCFullYear()
    for (const jaar of [basisJaar, basisJaar + 1]) {
      const kandidaat = new Date(Date.UTC(jaar, maand - 1, dag))
      if (kandidaat >= basisDatum) {
        return kandidaat.toISOString().slice(0, 10)
      }
    }
  }
  return null
}

/**
 * Parseer "binnen X weken", "in X Wochen", "in X Arbeitstagen", etc.
 * Bij ranges (4 – 8 weken) gebruiken we de bovengrens — conservatieve aanname.
 * Retourneert aantal dagen vanaf de orderdatum, of null.
 */
function parseDuur(tekst: string): number | null {
  const lc = tekst.toLowerCase()

  // Range: "4 - 8 weken", "4 – 8 Wochen"
  const rangeWeken = lc.match(/(\d+)\s*[–\-]\s*(\d+)\s*w(e|o)/)
  if (rangeWeken) return parseInt(rangeWeken[2], 10) * 7

  // Enkel: "X weken" / "X Wochen"
  const weken = lc.match(/(\d+)\s*w(e|o)/)
  if (weken) return parseInt(weken[1], 10) * 7

  // Werkdagen: "X werkdagen" / "X Arbeitstagen" / "X Arbeitstage"
  const werkdagen = lc.match(/(\d+)\s*(werkdag|arbeitstag)/)
  if (werkdagen) return parseInt(werkdagen[1], 10) * 1.5 // ruwe kalenderdag-schatting

  // Gewone dagen: "X dagen" / "X Tage" / "X Tagen"
  const dagen = lc.match(/(\d+)\s*(dagen|tage)/)
  if (dagen) return parseInt(dagen[1], 10)

  return null
}

export interface BepaalAfleverdatumResult {
  afleverdatum: string | null
  bron: 'deliveryDate' | 'shipmentTitle_datum' | 'shipmentTitle_duur' | 'fallback_weken' | 'geen_orderdatum'
  details?: string
}

/**
 * Bepaal de afleverdatum voor een Lightspeed-order.
 * `fallbackWeken` komt idealiter uit debiteuren.maatwerk_weken (Floorpassion=2).
 */
export function bepaalAfleverdatumUitOrder(
  order: LightspeedOrderForDate,
  fallbackWeken: number,
): BepaalAfleverdatumResult {
  const orderdatum = order.createdAt ? order.createdAt.slice(0, 10) : null

  // 1. Native deliveryDate
  if (order.deliveryDate) {
    const iso = order.deliveryDate.slice(0, 10)
    return { afleverdatum: naarWerkdag(iso), bron: 'deliveryDate' }
  }

  // 2. shipmentTitle — probeer concrete datum eerst
  const titel = order.shipmentTitle ?? ''
  if (titel && orderdatum) {
    const basis = new Date(`${orderdatum}T00:00:00Z`)
    const dagMaand = parseDagMaand(titel, basis)
    if (dagMaand) {
      return { afleverdatum: naarWerkdag(dagMaand), bron: 'shipmentTitle_datum', details: titel }
    }
    const duur = parseDuur(titel)
    if (duur !== null) {
      const afl = naarWerkdag(plusKalenderDagen(orderdatum, Math.ceil(duur)))
      return { afleverdatum: afl, bron: 'shipmentTitle_duur', details: titel }
    }
  }

  // 3. Fallback
  if (!orderdatum) {
    return { afleverdatum: null, bron: 'geen_orderdatum' }
  }
  const afl = naarWerkdag(plusKalenderDagen(orderdatum, fallbackWeken * 7))
  return { afleverdatum: afl, bron: 'fallback_weken' }
}
