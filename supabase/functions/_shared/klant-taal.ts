// Gedeelde klanttaal-bepaling voor klant-facing documenten (orderbevestiging
// e-mail + PDF, en de factuur-PDF). Taal volgt het land van het factuuradres
// (orders.fact_land / facturen.fact_land, genormaliseerd naar ISO2 via de
// SQL-functie normaliseer_land — single source of truth, ook gebruikt in de
// vervoerder-regelevaluator mig 214).
//
// Geëxtraheerd uit orderbevestiging-taal.ts (2026-06-18) zodat de factuur niet
// hoeft te importeren uit een module die "orderbevestiging" heet. De
// re-export-shim is verwijderd; alle callers importeren hier rechtstreeks.

export type Taal = 'nl' | 'de' | 'fr' | 'en'

export function bepaalTaal(landIso2: string | null): Taal {
  switch (landIso2) {
    case 'DE':
    case 'AT': return 'de'
    case 'FR': return 'fr'
    case 'NL':
    case 'BE': return 'nl'
    default:   return 'en'
  }
}

// ── Beperkte woord-vertaling voor orderregel-omschrijvingen ─────────────────
// Omschrijvingen zijn brondata (snapshot-tekst, ook letterlijk op de PDF) en
// soms al in de doeltaal opgesteld (bv. EDI-orders van Duitse partners bevatten
// al "Farbe"). Een woordenboek met hele-woord-matching is hierop veilig: het
// raakt alleen herkenbare NL-vaktermen en laat al-vertaalde tekst ongemoeid.
const REGEL_WOORDVERTALINGEN: Record<Exclude<Taal, 'nl'>, Record<string, string>> = {
  de: { Kleur: 'Farbe', Rond: 'Rund', Rechthoek: 'Rechteck', Ovaal: 'Oval', Karpet: 'Teppich', band: 'Band' },
  fr: { Kleur: 'Couleur', Rond: 'Rond', Rechthoek: 'Rectangle', Ovaal: 'Ovale', Karpet: 'Tapis', band: 'bande' },
  en: { Kleur: 'Colour', Rond: 'Round', Rechthoek: 'Rectangle', Ovaal: 'Oval', Karpet: 'Rug', band: 'band' },
}

// Meerwoordige frasen apart, met vaste vervangtekst — de hoofdletter-logica van
// de woord-loop zou "Op maat" → "Nach maß" maken (binnen-kapitaal gaat verloren).
// "afwerking:" (met colon) is bewust een fraseregel i.p.v. een los woord: de
// afwerkingsnaam "Volume afwerking" bevat ook het woord "afwerking", maar
// blijft onvertaald (besluit gebruiker 2026-06-18) — alleen het label vóór de
// colon (uit de afwerkingPresentatie-suffix) mag vertaald worden.
const REGEL_FRASEVERTALINGEN: Record<Exclude<Taal, 'nl'>, [RegExp, string][]> = {
  de: [[/\bop maat\b/gi, 'nach Maß'], [/\bafwerking:/gi, 'Verarbeitung:']],
  fr: [[/\bop maat\b/gi, 'sur mesure'], [/\bafwerking:/gi, 'finition:']],
  en: [[/\bop maat\b/gi, 'custom size'], [/\bafwerking:/gi, 'finish:']],
}

export function vertaalOmschrijving(tekst: string, taal: Taal): string {
  if (taal === 'nl') return tekst
  const woordenboek = REGEL_WOORDVERTALINGEN[taal]
  let resultaat = tekst
  for (const [patroon, vertaling] of REGEL_FRASEVERTALINGEN[taal]) {
    resultaat = resultaat.replace(patroon, (match) =>
      match[0] === match[0].toUpperCase()
        ? vertaling[0].toUpperCase() + vertaling.slice(1)
        : vertaling,
    )
  }
  for (const [nl, vertaling] of Object.entries(woordenboek)) {
    resultaat = resultaat.replace(new RegExp(`\\b${nl}\\b`, 'gi'), (match) => {
      if (match === match.toUpperCase()) return vertaling.toUpperCase()
      if (match[0] === match[0].toUpperCase()) return vertaling[0].toUpperCase() + vertaling.slice(1).toLowerCase()
      return vertaling.toLowerCase()
    })
  }
  return resultaat
}
