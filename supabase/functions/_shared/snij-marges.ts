// Snij-marges: extra cm bij snijden t.o.v. bestelde maat.
//
// ZO-afwerking: 6 cm rondom nodig (de afwerk-rand eet 6 cm op, dus een 120x120
// klant-stuk wordt als 126x126 gesneden en daarna afgewerkt naar 120x120).
//
// Rond/ovaal: 5 cm speling omdat de vorm met de hand wordt uitgezaagd — de
// rechthoekige snede moet ruim genoeg zijn om de ronding vrij te houden.
//
// Bij combi (ZO + rond) nemen we de grootste marge (niet cumulatief) zodat de
// opgeslagen brutomaat niet onnodig groeit.
//
// SQL-equivalent: supabase/migrations/126_snij_marges_zo_rond.sql
// (functie stuk_snij_marge_cm). Houd deze regels synchroon.

const AFWERKING_MARGE_CM: Record<string, number> = {
  ZO: 6,
}

const RONDE_VORMEN = new Set(['rond', 'ovaal'])

export function snijMargeCm(
  afwerking: string | null | undefined,
  vorm: string | null | undefined,
): number {
  const afwerkingMarge = afwerking ? (AFWERKING_MARGE_CM[afwerking] ?? 0) : 0
  const vormMarge = vorm && RONDE_VORMEN.has(vorm.toLowerCase()) ? 5 : 0
  return Math.max(afwerkingMarge, vormMarge)
}
