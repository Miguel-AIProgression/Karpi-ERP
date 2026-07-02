// Pure order-status-ladder — TS-spiegel van de SQL-functie derive_wacht_status
// (mig 346 + 352, betekenis van 'Wacht op inkoop'/'Wacht op voorraad' omgedraaid
// in mig 470; mig 564 voegde Combi-levering toe, ADR-0040). null = "niet
// wijzigen" (no-op). Gedrag MOET identiek zijn aan de SQL-functie; de gedeelde
// golden-fixture (derive-status.golden.json) borgt dat via de Vitest-
// contracttest, de mig-564-DO-assertie borgt de SQL-kant.
// ADR-0006: dit is de beloofde pure state-machine-functie.
// LET OP: géén Deno-only imports (npm:/jsr:/https://) toevoegen — dit bestand wordt
// direct door frontend-Vitest geïmporteerd. Wordt door frontend-contracttests
// rechtstreeks cross-root geïmporteerd — sinds ADR-0033 de standaard voor
// gedeelde pure modules (alleen relatieve, Deno-vrije imports).

import type { OrderStatus } from './order-status'

export type OrderWachtStatus = string  // bewust géén literal-union: order_status-enum-snapshot (Fase 1-stijl) is een aparte vervolgstap, buiten scope

const EINDSTATUS_OF_PICKRONDE: ReadonlySet<string> = new Set([
  // Mig 540: 'Concept' is no-touch — bevestig_concept_order (mig 541) is
  // de enige legitieme uitweg; herbereken_wacht_status mag deze niet overschrijven.
  'Concept',
  'Verzonden', 'Geannuleerd', 'Klaar voor verzending',
  'In productie', 'In snijplan', 'Deels gereed', 'Wacht op picken',
  'In pickronde', 'Deels verzonden',
  // Mig 352 (B13): terminaal voor productie-only orders — die hebben per
  // definitie maatwerk=true (snijplannen eindigen op confectie-afgerond,
  // niet 'Ingepakt'), dus zonder deze guard zou tak 4 ze terugzetten.
  'Maatwerk afgerond',
  // 'Wacht op combi-levering' zit hier BEWUST NIET in (mig 564) — moet
  // herhaaldelijk herevalueerbaar blijven, kan zowel promoveren naar 'Klaar
  // voor picken' als er symmetrisch aan ADR-0027 vanaf demoveren.
] as const satisfies readonly OrderStatus[])

const HERBEREKENBARE_WACHT: ReadonlySet<string> = new Set([
  'Wacht op inkoop', 'Wacht op voorraad', 'Wacht op maatwerk',
  'Wacht op combi-levering', 'Nieuw',
] as const satisfies readonly OrderStatus[])

export interface WachtStatusInput {
  huidig: OrderWachtStatus
  heeftIoClaim: boolean
  heeftTekort: boolean
  heeftMaatwerk: boolean
  /** Mig 564 (ADR-0040): klant wacht op de Combi-levering-drempel — laagste prioriteit. */
  wachtOpCombiLevering?: boolean
}

/** Spiegelt SQL derive_wacht_status(). Geeft de doelstatus of null (= no-op).
 *  Mig 470: 'Wacht op inkoop' = nog géén IO-claim (moet besteld worden),
 *  'Wacht op voorraad' = IO-claim bestaat al, wacht op levering.
 *  Mig 564: wachtOpCombiLevering heeft de laagste prioriteit — io/tekort/
 *  maatwerk winnen altijd; kan ook demoveren vanuit 'Klaar voor picken'. */
export function deriveWachtStatus(input: WachtStatusInput): OrderWachtStatus | null {
  const { huidig, heeftIoClaim, heeftTekort, heeftMaatwerk, wachtOpCombiLevering = false } = input
  if (EINDSTATUS_OF_PICKRONDE.has(huidig)) return null      // 1
  if (heeftIoClaim) return 'Wacht op voorraad'              // 2
  if (heeftTekort) return 'Wacht op inkoop'                 // 3
  if (heeftMaatwerk) return 'Wacht op maatwerk'             // 4
  if (wachtOpCombiLevering) return 'Wacht op combi-levering' // 5
  if (HERBEREKENBARE_WACHT.has(huidig)) return 'Klaar voor picken' // 6
  return null                                               // 7
}
