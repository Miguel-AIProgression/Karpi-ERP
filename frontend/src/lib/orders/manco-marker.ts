// Bron van waarheid voor het 'Had mankement'-predicaat (mig 518): orders waarop
// ooit een manco (niet-gevonden colli) is gedetecteerd. Permanent/historisch —
// blijft NOT NULL ook nadat het manco is afgehandeld en de order Verzonden is.
// Spiegelt het patroon van afleveradres-gate.ts / prijs-ontbreekt.ts, maar zonder
// status-exclusie (de marker is bewust historisch).

export interface MancoMarkerVelden {
  manco_sinds?: string | null
}

/** True als deze order ooit een manco-detectie had (historisch, nooit gewist). */
export function isMancoMarker(order: MancoMarkerVelden): boolean {
  return order.manco_sinds != null
}

interface PostgrestNot {
  not(column: string, op: string, value: unknown): PostgrestNot
}

/** Filtert orders op 'had een mankement' (manco_sinds gezet). */
export function filterMancoMarker<Q>(query: Q): Q {
  return (query as unknown as PostgrestNot).not('manco_sinds', 'is', null) as unknown as Q
}
