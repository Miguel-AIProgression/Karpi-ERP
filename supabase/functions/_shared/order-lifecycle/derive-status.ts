// Pure order-status-ladder — TS-spiegel van de SQL-functie derive_wacht_status
// (mig 346). null = "niet wijzigen" (no-op). Gedrag MOET identiek zijn aan de
// SQL-functie; de gedeelde golden-fixture (derive-status.golden.json) borgt dat
// via de Vitest-contracttest, de mig-346-DO-assertie borgt de SQL-kant.
// ADR-0006: dit is de beloofde pure state-machine-functie.

export type OrderWachtStatus = string  // order_status enum-waarde (DB-canoniek)

const EINDSTATUS_OF_PICKRONDE: ReadonlySet<string> = new Set([
  'Verzonden', 'Geannuleerd', 'Klaar voor verzending',
  'In productie', 'In snijplan', 'Deels gereed', 'Wacht op picken',
  'In pickronde', 'Deels verzonden',
])

const HERBEREKENBARE_WACHT: ReadonlySet<string> = new Set([
  'Wacht op inkoop', 'Wacht op voorraad', 'Wacht op maatwerk', 'Nieuw',
])

export interface WachtStatusInput {
  huidig: OrderWachtStatus
  heeftIoClaim: boolean
  heeftTekort: boolean
  heeftMaatwerk: boolean
}

/** Spiegelt SQL derive_wacht_status(). Geeft de doelstatus of null (= no-op). */
export function deriveWachtStatus(input: WachtStatusInput): OrderWachtStatus | null {
  const { huidig, heeftIoClaim, heeftTekort, heeftMaatwerk } = input
  if (EINDSTATUS_OF_PICKRONDE.has(huidig)) return null      // 1
  if (heeftIoClaim) return 'Wacht op inkoop'                // 2
  if (heeftTekort) return 'Wacht op voorraad'               // 3
  if (heeftMaatwerk) return 'Wacht op maatwerk'             // 4
  if (HERBEREKENBARE_WACHT.has(huidig)) return 'Klaar voor picken' // 5
  return null                                               // 6
}
