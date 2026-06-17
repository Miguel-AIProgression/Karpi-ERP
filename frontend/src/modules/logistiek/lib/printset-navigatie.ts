// Pure helper: bepaal de printset-route voor een set zojuist gestarte
// zendingen. Eén zending → de single-zending printset; meerdere → de
// bulk-printset met de zending-nummers als query-parameter.
//
// Gedeeld door StartWeekButton (hele week) en de multi-select-actiebalk
// (PickSelectieBalk) zodat "start pickronde(s) → print" overal exact hetzelfde
// pad kiest. Pure functie (geen React/router) → triviaal te testen + herbruikbaar.
export function printsetPadVoorZendingen(
  zendingen: { zending_nr: string }[],
): string {
  if (zendingen.length === 1) {
    return `/logistiek/${zendingen[0].zending_nr}/printset`
  }
  const qs = encodeURIComponent(zendingen.map((z) => z.zending_nr).join(','))
  return `/logistiek/printset/bulk?zendingen=${qs}`
}
