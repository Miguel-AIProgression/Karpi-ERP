// Compacte representatie van de vervoerder-keuze voor één order op pick-overview.
// Aggregeert per-orderregel-vervoerder tot één order-niveau code (uniform) of
// `null` (mixed / geen keuze / afhalen). Gebruikt door:
//   - `pick-overview.tsx` voor de vervoerder-filter-map die naar
//     `<VervoerderFilterButton>` gaat
//   - eventuele toekomstige consumers die vervoerder per order willen tonen
//     zonder zelf de aggregatie te doen
//
// Bron-van-waarheid voor de aggregatie blijft
// `aggregeerVervoerderKeuzeVoorOrder` in `queries/vervoerder-keuze.ts`. Dit
// type is alleen het result-shape.
//
// Vóór ADR-0012 leefde dit type in `modules/magazijn/lib/bundel-cluster.ts` —
// daar is hij weggehaald omdat de bijbehorende clustering-helper niet meer
// nodig is sinds `start_pickronden` (mig 248) de 4D-uitbreiding SQL-side doet.
export interface ResolvedVervoerder {
  /** Effectieve vervoerder-code, of `null` als geen (incl. afhalen of mix). */
  code: string | null
  /** TRUE als order op afhalen staat — geen vervoerder maar wel een filter-keuze. */
  afhalen: boolean
}
