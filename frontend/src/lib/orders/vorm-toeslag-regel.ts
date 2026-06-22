// Vormtoeslag als eigen orderregel (mig 465) — i.p.v. verwerkt in de
// per-m²-prijs van de maatwerk-regel, zodat de regel-korting% er niet
// overheen gaat (verzoek gebruiker 2026-06-22). Spiegelt het admin-pseudo-
// patroon van VERZEND/DROPSHIP (ADR-0018, dropshipment-regel.ts), met één
// verschil: de toeslag is PER maatwerk-regel i.p.v. per order, dus er kunnen
// meerdere VORMTOESLAG-companion-regels in één order voorkomen.
//
// Koppeling met de bijbehorende maatwerk-regel loopt bewust niet via een
// DB-FK maar via een array-positie-convention: de companion staat altijd
// direct ná zijn maatwerk-regel in de `lines`-array. Dat werkt betrouwbaar
// omdat regelnummer (en dus de array-volgorde bij het laden) bij elke save
// toch al herberekend wordt uit de array-positie (create/update_order_with_lines,
// `fetchOrderRegels` sorteert op regelnummer) — een extra koppel-kolom zou
// hier geen robuustheid toevoegen, alleen schema-churn.
import { berekenRegelBedrag } from './bedrag'
import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'

export const VORMTOESLAG_ARTIKEL_ID = 'VORMTOESLAG'

export function isVormToeslagRegel(
  regel: OrderRegelFormData | null | undefined,
): boolean {
  return regel?.artikelnr === VORMTOESLAG_ARTIKEL_ID
}

/**
 * Bouw de companion-regel voor een maatwerk-regel met vorm-toeslag > 0.
 * Aantal spiegelt de parent (toeslag is per fysiek stuk); korting altijd 0.
 * `bestaande` (indien zelf al een vormtoeslag-companion) levert het `id`
 * zodat de save-RPC een UPDATE doet i.p.v. delete+insert.
 */
export function maakVormToeslagRegel(
  parent: OrderRegelFormData,
  vormNaam: string,
  vormToeslag: number,
  bestaande?: OrderRegelFormData,
): OrderRegelFormData {
  const aantal = parent.orderaantal ?? 1
  return {
    id: bestaande && isVormToeslagRegel(bestaande) ? bestaande.id : undefined,
    artikelnr: VORMTOESLAG_ARTIKEL_ID,
    omschrijving: `Vormtoeslag — ${vormNaam}`,
    orderaantal: aantal,
    te_leveren: aantal,
    prijs: vormToeslag,
    korting_pct: 0,
    bedrag: berekenRegelBedrag(vormToeslag, aantal, 0),
    is_maatwerk: false,
    is_pseudo: true,
  }
}

/**
 * Zorgt dat de regel direct ná `parentIndex` de bijbehorende VORMTOESLAG-
 * companion is wanneer `lines[parentIndex]` een maatwerk-regel met
 * `maatwerk_vorm_toeslag > 0` is — voegt toe, werkt bij (aantal/prijs/naam)
 * of verwijdert, naar wat de huidige staat van de parent vereist.
 */
export function syncVormToeslagRegel(
  lines: OrderRegelFormData[],
  parentIndex: number,
  vormNaam: string,
): OrderRegelFormData[] {
  const parent = lines[parentIndex]
  const vormToeslag = parent?.maatwerk_vorm_toeslag ?? 0
  const companionIndex = parentIndex + 1
  const existing = lines[companionIndex]
  const heeftCompanion = isVormToeslagRegel(existing)

  if (!parent?.is_maatwerk || vormToeslag <= 0) {
    if (!heeftCompanion) return lines
    return [...lines.slice(0, companionIndex), ...lines.slice(companionIndex + 1)]
  }

  const companion = maakVormToeslagRegel(parent, vormNaam, vormToeslag, existing)
  if (heeftCompanion) {
    return [...lines.slice(0, companionIndex), companion, ...lines.slice(companionIndex + 1)]
  }
  return [...lines.slice(0, companionIndex), companion, ...lines.slice(companionIndex)]
}

/**
 * Verwijdert een regel; als het een maatwerk-regel met companion is, gaat
 * de companion in dezelfde stap mee (1 gebruikersactie = 1 logische regel).
 * Een companion zelf verwijderen (zonder de parent) blijft een gewone
 * los-staande filter — geen cascade nodig.
 */
export function verwijderRegelMetCompanion(
  lines: OrderRegelFormData[],
  index: number,
): OrderRegelFormData[] {
  const companionIndex = index + 1
  const heeftCompanion = !!lines[index]?.is_maatwerk && isVormToeslagRegel(lines[companionIndex])
  return lines.filter((_, i) => i !== index && !(heeftCompanion && i === companionIndex))
}
