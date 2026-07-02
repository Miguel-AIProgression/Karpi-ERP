// Canonieke order_status-waardenlijst — TS-kant van het enum-anker.
// SQL-kant: mig 350 (set-assert tegen de live enum). Golden-fixture:
// __tests__/order-status.golden.json. Bij een enum-wijziging (ALTER TYPE
// order_status ADD VALUE) MOETEN alle drie in één commit mee — de Vitest-
// contracttest en de mig 350-opvolger-assert dwingen dat af.
// LET OP: géén Deno-only imports (npm:/jsr:/https://) — dit bestand wordt
// direct door frontend-Vitest geïmporteerd (zelfde seam als derive-status.ts).
// Set-semantiek: volgorde is NIET betekenis-dragend (mig 350-keuze).

/** Statussen die actief geschreven worden (ADR-0016 + mig 308/327 + mig 563/ADR-0040). */
export const ORDER_STATUSSEN_CANONIEK = [
  'Concept', 'Klaar voor picken', 'Wacht op voorraad', 'Wacht op inkoop',
  'Wacht op maatwerk', 'Wacht op combi-levering', 'In pickronde',
  'Deels verzonden', 'Verzonden', 'Geannuleerd', 'Maatwerk afgerond',
] as const

/** Bestaan nog in de enum maar worden niet meer geschreven ('In productie' hergebruikt door mig 329). */
export const ORDER_STATUSSEN_LEGACY = [
  'Nieuw', 'Actie vereist', 'Wacht op picken', 'In snijplan',
  'In productie', 'Deels gereed', 'Klaar voor verzending',
] as const

/** Alle enum-waarden (canoniek + legacy) — spiegelt enum_range(NULL::order_status) als set. */
export const ORDER_STATUSSEN = [
  ...ORDER_STATUSSEN_CANONIEK, ...ORDER_STATUSSEN_LEGACY,
] as const

export type OrderStatus = (typeof ORDER_STATUSSEN)[number]
