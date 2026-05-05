// Frontend-kopie van supabase/functions/_shared/snij-marges.ts
// Houd synchroon met de backend-versie en met supabase/migrations/126_snij_marges_zo_rond.sql

const AFWERKING_MARGE_CM: Record<string, number> = {
  ZO: 6,
}

const RONDE_VORMEN = new Set(['rond', 'ovaal'])

/**
 * Extra snij-cm voor een stuk op basis van afwerking en vorm.
 * ZO: +6 cm (zoom-rand eet materiaal op), rond/ovaal: +5 cm (marge voor vrijzagen).
 * Bij combi: grootste wint (niet cumulatief).
 */
export function snijMargeCm(
  afwerking: string | null | undefined,
  vorm: string | null | undefined,
): number {
  const afwerkingMarge = afwerking ? (AFWERKING_MARGE_CM[afwerking] ?? 0) : 0
  const vormMarge = vorm && RONDE_VORMEN.has(vorm.toLowerCase()) ? 5 : 0
  return Math.max(afwerkingMarge, vormMarge)
}

/** True als de marge voortkomt uit de vorm (rond/ovaal) — dan bijsnijden nodig. */
export function isRondeVorm(vorm: string | null | undefined): boolean {
  return !!vorm && RONDE_VORMEN.has(vorm.toLowerCase())
}
