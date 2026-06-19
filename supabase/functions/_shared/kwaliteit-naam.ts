// Kwaliteitsnaam uit `producten.vervolgomschrijving` — gedeelde pure helper
// (ADR-0033). Eén bron voor het verzendlabel (frontend shipping-label-data.ts,
// besluit 2026-06-18) én de factuur-PDF (kwaliteitnaam − afmeting op de regel).
//
// Géén DB/netwerk — puur tekst-parsing, los te unit-testen.

// Tokens die het einde van de kwaliteitsnaam markeren in vervolgomschrijving:
// "Kleur"/"Farbe"/"Kl."/"CA:" (NL + DE varianten uit de oude-systeem-import).
const KWALITEIT_MARKER = /^(kleur|farbe|kl\.?|ca[:.]?)$/i

/**
 * Haal de kwaliteitsnaam uit `producten.vervolgomschrijving`.
 *
 * Het oude systeem schreef die als "{KWALITEITNAAM} Kleur {nr} CA: {maat} cm"
 * (varianten: "Farbe"/"Kl."/los kleurnummer/artikelcode). De naam = de leidende
 * woorden tot het EERSTE token dat een cijfer bevat of een kleur-/CA-marker is.
 * Geverifieerd op 18.181 vaste producten: 0 lekken een code/cijfer, 23 leveren
 * geen naam (vallen terug op het oude labelgedrag).
 *
 * Bron-keuze (2026-06-18): `kwaliteiten.omschrijving` was de logische plek maar
 * staat in de hele DB leeg (997/997 NULL); `vervolgomschrijving` is gevuld voor
 * 99,9% van de vaste producten.
 */
export function kwaliteitNaamUitVervolg(vervolg: string | null | undefined): string | null {
  if (!vervolg) return null
  const woorden: string[] = []
  for (const token of vervolg.replace(/\s+/g, ' ').trim().split(' ')) {
    if (/\d/.test(token) || KWALITEIT_MARKER.test(token)) break
    woorden.push(token)
  }
  return woorden.join(' ').trim() || null
}
