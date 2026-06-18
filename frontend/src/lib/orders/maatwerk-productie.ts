// Productie-status van een maatwerk-orderregel — puur display-hulpmiddel.
//
// `order_regels.te_leveren` staat voor maatwerk meteen op het orderaantal: de
// allocator slaat maatwerk bewust over (reserveert niet op voorraad/inkoop),
// dus het getal wordt nooit herberekend. De échte voortgang zit in de
// snijplannen (Wacht → Gepland → Snijden → Gesneden → In confectie → Gereed →
// Ingepakt). Een maatwerk-regel is fysiek klaar/leverbaar zodra álle
// snijplannen op 'Ingepakt' staan — dezelfde drempel als de pickbaarheid-view
// (mig 386). Deze helper raakt `te_leveren` NIET aan; hij bepaalt alleen of de
// "Te leveren"-kolom het getal mag tonen of nog "In productie".

import type { SnijplanStatus } from '@/lib/utils/snijplan-status'

/** Status waarop een maatwerk-stuk fysiek klaar (ingepakt) en leverbaar is. */
const KLAAR_STATUS: SnijplanStatus = 'Ingepakt'

/** Status die een snijplan buiten beschouwing laat (telt niet mee). */
const GENEGEERD_STATUS: SnijplanStatus = 'Geannuleerd'

interface SnijplanLike {
  status: string
}

/**
 * Bepaalt of een maatwerk-orderregel volledig geproduceerd (klaar voor
 * levering) is, op basis van de snijplan-statussen van de regel.
 *
 * Klaar = er is minstens één niet-geannuleerd snijplan én álle
 * niet-geannuleerde snijplannen staan op 'Ingepakt'. Zolang er nog iets in
 * productie is — of er nog geen snijplan bestaat — is de regel niet klaar.
 */
export function isMaatwerkProductieKlaar(
  snijplannen: readonly SnijplanLike[] | null | undefined,
): boolean {
  if (!snijplannen || snijplannen.length === 0) return false
  const actief = snijplannen.filter((sp) => sp.status !== GENEGEERD_STATUS)
  if (actief.length === 0) return false
  return actief.every((sp) => sp.status === KLAAR_STATUS)
}
