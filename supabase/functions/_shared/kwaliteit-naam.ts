// Kwaliteitsnaam + leveranciers-kleurcode uit `producten.vervolgomschrijving` —
// gedeelde pure helpers (ADR-0033). Eén bron voor het verzendlabel (frontend
// shipping-label-data.ts, besluit 2026-06-18) én de factuur-PDF (kwaliteitnaam
// − afmeting op de regel).
//
// Géén DB/netwerk — puur tekst-parsing, los te unit-testen.

// Tokens die het einde van de kwaliteitsnaam markeren in vervolgomschrijving:
// "Kleur"/"Farbe"/"Kl."/"CA:" (NL + DE varianten uit de oude-systeem-import).
const KWALITEIT_MARKER = /^(kleur|farbe|kl\.?|ca[:.]?)$/i

// Sommige leveranciers stickeren hun rollen met een EIGEN kleurcode die niet
// overeenkomt met Karpi's interne kleur_code (mail Pick & Ship 2026-07-01:
// Sofia 80x150 toont intern "13", de fysieke rol draagt sticker "G305"). Die
// code staat dan als extra token TUSSEN de kwaliteitsnaam en de marker:
// "SOFIA 3726-G305 CA: 080x150 cm" — "3726" is een leveranciers-/collectie-
// referentie, "G305" (ná de streep) is de kleurcode die op de sticker moet.
// Patroon geverifieerd tegen alle 21.801 vaste/staaltje-producten (2026-07-01):
// matcht exact de 280 producten (18 kwaliteiten) met een echte alternatieve
// kleurcode, en NUL van de overige "extra tekst"-varianten (losse dessin-
// nummers als "1200", parse-artefacten als "Kl.63", vrije ruis).
const LEVERANCIERS_KLEURCODE = /^\d{3,6}-([0-9A-Za-z]{2,6})$/

interface VervolgSegmenten {
  /** Kwaliteitsnaam (leidende woorden tot het eerste cijfer/marker-token). */
  naam: string | null
  /**
   * Ruwe tekst tussen het einde van de naam en het marker-token, of `null`
   * als die er niet is óf er geen marker-token gevonden werd (geen
   * betrouwbare grens → geen extra info tonen).
   */
  extra: string | null
}

/**
 * Splitst vervolgomschrijving in kwaliteitsnaam + eventuele extra tekst vóór
 * de "Kleur"/"Farbe"/"Kl."/"CA:"-marker. Interne tokenizer, gedeeld door
 * `kwaliteitNaamUitVervolg` en `leverancierskleurcodeUitVervolg` zodat beide
 * exact dezelfde grens hanteren.
 */
function segmenteerVervolg(vervolg: string | null | undefined): VervolgSegmenten {
  if (!vervolg) return { naam: null, extra: null }
  const tokens = vervolg.replace(/\s+/g, ' ').trim().split(' ')

  const naamWoorden: string[] = []
  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]
    if (/\d/.test(token) || KWALITEIT_MARKER.test(token)) break
    naamWoorden.push(token)
    i++
  }
  const naam = naamWoorden.join(' ').trim() || null

  const extraWoorden: string[] = []
  let j = i
  while (j < tokens.length && !KWALITEIT_MARKER.test(tokens[j])) {
    extraWoorden.push(tokens[j])
    j++
  }
  // Alleen als er ECHT een marker-token ná de extra-tekst gevonden is, is de
  // grens betrouwbaar — anders (bv. een kale artikelcode zonder "CA:") geen
  // extra info retourneren.
  const markerGevonden = j < tokens.length
  const extra = markerGevonden ? extraWoorden.join(' ').trim() || null : null

  return { naam, extra }
}

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
  return segmenteerVervolg(vervolg).naam
}

/**
 * Haal de leveranciers-kleurcode uit `producten.vervolgomschrijving`, of
 * `null` als die er niet is (de overgrote meerderheid van de producten).
 *
 * Herkenning (2026-07-01, mail Pick & Ship): de extra tekst tussen naam en
 * marker moet EXACT het patroon "{3-6 cijfers}-{2-6 alfanumeriek}" volgen (bv.
 * "3726-G305") — dat sluit dessin-nummers ("1200"), "Kl.NN"-parse-artefacten
 * en vrije ruis uit (matchen dit patroon niet, of bevatten spaties). Retourneert
 * alleen het deel NÁ de streep ("G305"), niet de leveranciers-/collectie-
 * referentie ervoor — dát is de code die op de sticker hoort.
 */
export function leverancierskleurcodeUitVervolg(vervolg: string | null | undefined): string | null {
  const { extra } = segmenteerVervolg(vervolg)
  if (!extra) return null
  const match = LEVERANCIERS_KLEURCODE.exec(extra)
  return match ? match[1] : null
}
