// GTIN-resolutie voor de uitgaande EDI-orderbevestiging (ORDRSP).
//
// Achtergrond: een ORDRSP hoort per regel de GTIN terug te geven die de KOPER
// in de inkomende order aanleverde. Die GTIN zit in het inkomende EDI-bericht
// (de payload), niet noodzakelijk in `producten.ean_code`: een EDI-order matcht
// vaak op artikelcode i.p.v. GTIN (`match_edi_artikel`, mig 159), waardoor het
// gematchte product een lege `ean_code` kan hebben. De orderbev-builder leidde
// de GTIN voorheen uitsluitend uit `producten.ean_code` af → "regel N GTIN
// ontbreekt" terwijl de GTIN gewoon in het bericht stond.
//
// Deze module raakt ALLEEN het uitgaande orderbev-pad. Het ontvangen van orders
// (transus-poll → create_edi_order) gebruikt dit niet.

export interface BerichtRegelGtin {
  regelnummer: number
  gtin: string
}

/**
 * Haal de regel-GTIN's uit een orderbev-payload. De payload kent twee vormen,
 * afhankelijk van de call-site:
 *   - bevestig-flow:  `payload.regels[]`         (OrderbevInput direct)
 *   - download-flow:  `payload.source.regels[]`  (opgeslagen uitgaand bericht)
 * Beide dragen per regel `regelnummer` + `gtin` (overgenomen uit de inkomende
 * order). Onbekende/lege waarden komen als 0 resp. '' terug.
 */
export function extractBerichtRegels(
  payload: Record<string, unknown> | null | undefined,
): BerichtRegelGtin[] {
  if (!payload) return []
  const direct = payload.regels
  const source = payload.source as Record<string, unknown> | undefined
  const viaSource = source?.regels
  const arr = Array.isArray(direct) ? direct : Array.isArray(viaSource) ? viaSource : []
  return arr.map((entry) => {
    const o = (entry ?? {}) as Record<string, unknown>
    const nr = Number(o.regelnummer)
    return {
      regelnummer: Number.isFinite(nr) ? nr : 0,
      gtin: typeof o.gtin === 'string' ? o.gtin.trim() : '',
    }
  })
}

/**
 * Bouw een resolver die per DB-orderregel de GTIN uit het inkomende bericht
 * teruggeeft, of '' als die er niet is (caller valt dan terug op ean_code).
 *
 * Koppeling:
 *   1. exacte regelnummer-match (Hornbach gebruikt vaak 1..n) — robuust ook bij
 *      een bewerkte order;
 *   2. anders positie-index, maar ALLEEN als het aantal bericht-regels gelijk is
 *      aan het aantal DB-regels (onbewerkte order) — zo voorkomen we dat een
 *      verschoven index een verkeerde GTIN aan een regel plakt.
 * Lege GTIN's tellen niet als match, zodat de caller naar ean_code terugvalt.
 */
export function maakBerichtGtinResolver(
  payload: Record<string, unknown> | null | undefined,
  dbRegelCount: number,
): (regelnummer: number, index: number) => string {
  const regels = extractBerichtRegels(payload)
  return (regelnummer, index) => {
    const opNummer = regels.find((g) => g.regelnummer === regelnummer && g.gtin !== '')
    if (opNummer) return opNummer.gtin
    if (regels.length === dbRegelCount) {
      const opIndex = regels[index]
      if (opIndex && opIndex.gtin !== '') return opIndex.gtin
    }
    return ''
  }
}
