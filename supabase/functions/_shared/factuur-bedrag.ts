// Pure rekenhelper voor factuur-totalen. Geen DB-afhankelijkheid.
// Zie plan: docs/superpowers/plans/2026-04-22-facturatie-module.md

export interface FactuurRegelBedrag {
  bedrag: number
}

export interface FactuurTotalen {
  subtotaal: number
  btw_bedrag: number
  totaal: number
}

export function berekenFactuurTotalen(
  regels: FactuurRegelBedrag[],
  btw_percentage: number,
): FactuurTotalen {
  const subtotaal = round2(regels.reduce((sum, r) => sum + r.bedrag, 0))
  const btw_bedrag = round2(subtotaal * btw_percentage / 100)
  const totaal = round2(subtotaal + btw_bedrag)
  return { subtotaal, btw_bedrag, totaal }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
