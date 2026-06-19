// Gedeelde klanttaal-bepaling voor klant-facing documenten (orderbevestiging
// e-mail + PDF, en de factuur-PDF). Taal volgt het land van het factuuradres
// (orders.fact_land / facturen.fact_land, genormaliseerd naar ISO2 via de
// SQL-functie normaliseer_land — single source of truth, ook gebruikt in de
// vervoerder-regelevaluator mig 214).
//
// Geëxtraheerd uit orderbevestiging-taal.ts (2026-06-18) zodat de factuur niet
// hoeft te importeren uit een module die "orderbevestiging" heet;
// orderbevestiging-taal.ts re-exporteert dit ongewijzigd.

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
  de: { Kleur: 'Farbe', Rond: 'Rund', Rechthoek: 'Rechteck', Ovaal: 'Oval', Karpet: 'Teppich' },
  fr: { Kleur: 'Couleur', Rond: 'Rond', Rechthoek: 'Rectangle', Ovaal: 'Ovale', Karpet: 'Tapis' },
  en: { Kleur: 'Colour', Rond: 'Round', Rechthoek: 'Rectangle', Ovaal: 'Oval', Karpet: 'Rug' },
}

// Meerwoordige frasen apart, met vaste vervangtekst — de hoofdletter-logica van
// de woord-loop zou "Op maat" → "Nach maß" maken (binnen-kapitaal gaat verloren).
const REGEL_FRASEVERTALINGEN: Record<Exclude<Taal, 'nl'>, [RegExp, string][]> = {
  de: [[/\bop maat\b/gi, 'nach Maß']],
  fr: [[/\bop maat\b/gi, 'sur mesure']],
  en: [[/\bop maat\b/gi, 'custom size']],
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
