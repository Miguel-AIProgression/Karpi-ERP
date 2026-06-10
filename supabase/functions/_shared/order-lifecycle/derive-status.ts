// Pure order-status-ladder — TS-spiegel van de SQL-functie derive_wacht_status
// (mig 346 + 352). null = "niet wijzigen" (no-op). Gedrag MOET identiek zijn aan de
// SQL-functie; de gedeelde golden-fixture (derive-status.golden.json) borgt dat
// via de Vitest-contracttest, de mig-352-DO-assertie borgt de SQL-kant.
// ADR-0006: dit is de beloofde pure state-machine-functie.
// LET OP: géén Deno-only imports (npm:/jsr:/https://) toevoegen — dit bestand wordt
// direct door frontend-Vitest geïmporteerd (eerste cross-root import; bewust afwijkend
// van het kopie-seam-patroon van bv. vervoerder-eisen.ts, dat kan omdat dit bestand
// import-vrij is).

export type OrderWachtStatus = string  // bewust géén literal-union: order_status-enum-snapshot (Fase 1-stijl) is een aparte vervolgstap, buiten scope

const EINDSTATUS_OF_PICKRONDE: ReadonlySet<string> = new Set([
  'Verzonden', 'Geannuleerd', 'Klaar voor verzending',
  'In productie', 'In snijplan', 'Deels gereed', 'Wacht op picken',
  'In pickronde', 'Deels verzonden',
  // Mig 352 (B13): terminaal voor productie-only orders — die hebben per
  // definitie maatwerk=true (snijplannen eindigen op confectie-afgerond,
  // niet 'Ingepakt'), dus zonder deze guard zou tak 4 ze terugzetten.
  'Maatwerk afgerond',
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
