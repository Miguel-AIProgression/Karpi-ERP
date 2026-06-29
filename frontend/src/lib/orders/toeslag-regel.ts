// Klant-toeslag orderregel (mig 528/529).
//
// De toeslag verschijnt als pseudo-orderregel (artikelnr='TOESLAG', is_pseudo=TRUE)
// in de order — puur voor display. Op de factuur wordt de toeslag NIET als
// factuur_regel opgenomen maar als aparte sectie in de totalen-box (Optie II).
//
// De toeslag is geldig als CURRENT_DATE binnen [toeslag_begindatum, toeslag_einddatum].
// Na de einddatum verdwijnt de regel vanzelf bij de eerste herberekening.

import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'
import { TOESLAG_PRODUCT_ID } from '@/lib/constants/toeslag'

/** Subset van SelectedClient die de toeslag-logica nodig heeft. */
export interface KlantToeslagInfo {
  toeslag_actief: boolean
  toeslag_procent: number | null
  toeslag_omschrijving: string | null
  toeslag_begindatum: string | null  // ISO YYYY-MM-DD
  toeslag_einddatum: string | null   // ISO YYYY-MM-DD
}

/** Formatteer een procent-getal naar NL-notatie (4.5 → "4,5", 4.0 → "4"). */
export function formatProcent(procent: number): string {
  const s = String(procent).replace(/\.?0+$/, '')
  return s.replace('.', ',')
}

/** Vervang {percentage} in de toeslagtekst door het geformatteerde percentage. */
export function substitueerPercentage(tekst: string, procent: number): string {
  return tekst.replace('{percentage}', formatProcent(procent))
}

function isToeslagGeldig(client: KlantToeslagInfo, currentDate: Date): boolean {
  if (!client.toeslag_actief || client.toeslag_procent == null) return false
  if (!client.toeslag_begindatum || !client.toeslag_einddatum) return false
  const d = currentDate
  const begin = new Date(client.toeslag_begindatum)
  const eind = new Date(client.toeslag_einddatum)
  // Date-only vergelijking: normaliseer naar middag om timezone-problemen te voorkomen.
  const check = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const from  = new Date(begin.getUTCFullYear(), begin.getUTCMonth(), begin.getUTCDate())
  const to    = new Date(eind.getUTCFullYear(), eind.getUTCMonth(), eind.getUTCDate())
  return check >= from && check <= to
}

/**
 * Synchroniseert de TOESLAG-orderregel op basis van de klant-instellingen en de datum.
 *
 * - Toeslag geldig + geen TOESLAG-regel aanwezig → voegt regel toe (berekend op
 *   product-subtotaal, excl. VERZEND en TOESLAG zelf).
 * - Toeslag geldig + TOESLAG-regel aanwezig → updatet bedrag/omschrijving.
 * - Toeslag NIET geldig + TOESLAG-regel aanwezig → verwijdert de regel.
 * - Geen toeslag van toepassing, geen regel → ongewijzigd.
 *
 * Pure functie — geen side effects. Idempotent bij herhaalde aanroep.
 * Analoog aan applyShippingLogic (verzend-regel.ts).
 */
export function applyToeslagLogic(
  regels: OrderRegelFormData[],
  client: KlantToeslagInfo | null,
  currentDate: Date = new Date(),
): OrderRegelFormData[] {
  const heeftToeslagRegel = regels.some((r) => r.artikelnr === TOESLAG_PRODUCT_ID)

  if (!client || !isToeslagGeldig(client, currentDate)) {
    // Geen geldige toeslag: verwijder eventuele aanwezige TOESLAG-regel.
    return heeftToeslagRegel
      ? regels.filter((r) => r.artikelnr !== TOESLAG_PRODUCT_ID)
      : regels
  }

  const procent = client.toeslag_procent!

  // Product-subtotaal = SUM(bedrag) excl. VERZEND en TOESLAG zelf.
  const productSubtotaal = regels
    .filter((r) => r.artikelnr !== 'VERZEND' && r.artikelnr !== TOESLAG_PRODUCT_ID)
    .reduce((sum, r) => sum + (r.bedrag ?? 0), 0)

  const toeslagBedrag = Math.round(productSubtotaal * procent) / 100
  const omschrijving = client.toeslag_omschrijving
    ? substitueerPercentage(client.toeslag_omschrijving, procent)
    : `Toeslag ${formatProcent(procent)}%`

  if (heeftToeslagRegel) {
    // Update bestaande regel (bedrag kan veranderen bij regelwijziging).
    return regels.map((r) =>
      r.artikelnr === TOESLAG_PRODUCT_ID
        ? { ...r, omschrijving, prijs: toeslagBedrag, bedrag: toeslagBedrag }
        : r
    )
  }

  // Voeg nieuwe TOESLAG-regel toe (altijd achteraan, vóór VERZEND-regel).
  const toeslagRegel: OrderRegelFormData = {
    artikelnr: TOESLAG_PRODUCT_ID,
    omschrijving,
    orderaantal: 1,
    te_leveren: 1,
    prijs: toeslagBedrag,
    korting_pct: 0,
    bedrag: toeslagBedrag,
    is_pseudo: true,
  }

  // Invoegen direct vóór de VERZEND-regel als die aanwezig is, anders achteraan.
  const verzendIdx = regels.findIndex((r) => r.artikelnr === 'VERZEND')
  if (verzendIdx === -1) {
    return [...regels, toeslagRegel]
  }
  const result = [...regels]
  result.splice(verzendIdx, 0, toeslagRegel)
  return result
}
