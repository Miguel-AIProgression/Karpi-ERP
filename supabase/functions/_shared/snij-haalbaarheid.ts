// ----------------------------------------------------------------------------
// EIGENAAR-MODULE: maatwerk-haalbaarheid (snij-deadline + status) — de enige
// implementatie (ADR-0033). Verplaatst hierheen vanuit frontend/src/lib/orders/
// snij-haalbaarheid.ts (2026-06-20, Fase 2) omdat `auto-plan-groep` dezelfde
// deadline-formule nodig heeft voor de verdringingscheck — twee kopieën zou
// het soort drift-risico zijn dat dit project al pijnlijk heeft geleerd
// (SSCC/labelbarcode-incident). De frontend importeert dit bestand direct
// (patroon: werkagenda.ts/bereken-agenda.ts).
//
// Bewust GEEN import van het frontend-only `PlanningConfig`-type — `_shared/`
// mag niet van `frontend/` afhangen (ADR-0033, eenrichting). `SnijDeadlineConfig`
// hieronder is de minimale, lokale vorm; `PlanningConfig` voldoet er structureel
// al aan, dus de frontend-caller geeft gewoon zijn eigen config-object door.
//
// Snij-deadline-formule (vastgelegd na Q&A met de gebruiker 2026-06-19):
//   - lever_type='week'  → afleverdatum − config.logistieke_buffer_dagen
//     (dekt confectie 1 dag + klaarleggen 1 dag, default 2 werkdagen)
//   - lever_type='datum' → afleverdatum − config.dag_order_snij_buffer_werkdagen
//     (bestaand ADR-0014-gedrag, default 2 werkdagen)
// Risico-marge (vastgelegd): 3 werkdagen vóór de snij-deadline → oranje.
// Voorbij de deadline zonder gesneden → rood. Meer marge → groen.

import { werkdagMinN, werkdagenTussen, type Werktijden } from './werkagenda.ts'

export type LeverType = 'week' | 'datum'

export type HaalbaarheidStatus = 'groen' | 'oranje' | 'rood'

export interface SnijDeadlineConfig {
  logistieke_buffer_dagen: number
  dag_order_snij_buffer_werkdagen: number
}

const RISICO_MARGE_WERKDAGEN = 3

/** Bepaal de snij-deadline (ISO YYYY-MM-DD) voor een order. */
export function bepaalSnijDeadline(
  afleverdatum: string,
  leverType: LeverType,
  config: SnijDeadlineConfig,
  werktijden: Werktijden,
): string {
  const buffer = leverType === 'datum'
    ? config.dag_order_snij_buffer_werkdagen
    : config.logistieke_buffer_dagen
  return werkdagMinN(afleverdatum, buffer, werktijden)
}

/**
 * Vergelijk vandaag met de snij-deadline. `rood` als de deadline al voorbij
 * is (en het stuk dus per definitie nog niet gesneden is — de caller
 * gebruikt dit alleen voor niet-terminale stukken); `oranje` binnen de
 * risico-marge; anders `groen`.
 */
export function bepaalHaalbaarheidStatus(
  snijDeadline: string,
  vandaag: string,
  werktijden: Werktijden,
  risicoMargeWerkdagen: number = RISICO_MARGE_WERKDAGEN,
): HaalbaarheidStatus {
  if (vandaag > snijDeadline) return 'rood'
  const margeWerkdagen = werkdagenTussen(vandaag, snijDeadline, werktijden)
  return margeWerkdagen <= risicoMargeWerkdagen ? 'oranje' : 'groen'
}

export interface HaalbaarheidResultaat {
  snijDeadline: string
  margeWerkdagen: number
  status: HaalbaarheidStatus
}

/** Combineert beide stappen — het gangbare aanroep-pad. */
export function berekenHaalbaarheid(
  afleverdatum: string,
  leverType: LeverType,
  config: SnijDeadlineConfig,
  werktijden: Werktijden,
  vandaag: string,
  risicoMargeWerkdagen: number = RISICO_MARGE_WERKDAGEN,
): HaalbaarheidResultaat {
  const snijDeadline = bepaalSnijDeadline(afleverdatum, leverType, config, werktijden)
  const margeWerkdagen = werkdagenTussen(vandaag, snijDeadline, werktijden)
  const status = bepaalHaalbaarheidStatus(snijDeadline, vandaag, werktijden, risicoMargeWerkdagen)
  return { snijDeadline, margeWerkdagen, status }
}
