// Zending-status-predicaten. 'Gepland' is een overladen string ('Gepland'
// bestaat óók als snijplan_status met een andere betekenis) — check zending-
// status daarom via deze helpers, nooit via een kale stringvergelijking.
// Semantiek sinds mig 477: 'Gepland' = deelzending aangemaakt maar pickronde
// nog niet gestart; 'Picken' = pickronde loopt.

/** Lopende zending-statussen (mig 477) — de ene bron voor `isZendingLopend`. */
export const ZENDING_LOPEND = ['Gepland', 'Picken'] as const

/** Zending is aangemaakt (deelzending gereserveerd) maar de pickronde is
 *  nog niet gestart (mig 477). */
export function isZendingGepland(status: string | null | undefined): boolean {
  return status === 'Gepland'
}

/** Zending is "lopend": aangemaakt-maar-niet-gestart ('Gepland') of de
 *  pickronde loopt ('Picken'). */
export function isZendingLopend(status: string | null | undefined): boolean {
  return (ZENDING_LOPEND as readonly string[]).includes(status ?? '')
}
