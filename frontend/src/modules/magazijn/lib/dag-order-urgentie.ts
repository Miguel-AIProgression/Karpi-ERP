// Urgentie-label voor een dag-order (`lever_type='datum'`, ADR 0014) op
// Pick & Ship. Zo'n order wordt al pas zichtbaar vanaf 1 werkdag vóór de
// afleverdatum (horizon-filter in queries/pickbaarheid.ts) — zodra hij dus
// in de lijst staat, is "vandaag verzenden" per definitie het devies. Is de
// afleverdatum al verstreken zonder dat de order verzonden is, dan is de
// belofte al gemist — dat krijgt het zwaardere `te_laat`-label.
export type DagOrderUrgentie = 'vandaag' | 'te_laat'

/** Vandaag in lokale tijd als ISO YYYY-MM-DD (mirrort isoLokaal in queries/pickbaarheid.ts). */
function isoLokaal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function bepaalDagOrderUrgentie(
  afleverdatum: string,
  vandaag: Date = new Date(),
): DagOrderUrgentie {
  return afleverdatum < isoLokaal(vandaag) ? 'te_laat' : 'vandaag'
}
