// ----------------------------------------------------------------------------
// Dunne re-export-shim — géén eigen rekenkunde meer.
// ----------------------------------------------------------------------------
// De maatwerk-haalbaarheid-logica (snij-deadline + groen/oranje/rood-status)
// leeft sinds 2026-06-20 (Fase 2) uitsluitend in
// supabase/functions/_shared/snij-haalbaarheid.ts en wordt hier direct
// geïmporteerd (patroon: werkagenda/bereken-agenda.ts, ADR-0033) — nodig omdat
// `auto-plan-groep` dezelfde formule gebruikt voor de verdringingscheck.
//
// `PlanningConfig` (productie.ts) voldoet structureel al aan het lokale
// `SnijDeadlineConfig`-type uit de kernel; bestaande callers met een
// `PlanningConfig`-object blijven dus ongewijzigd werken.

export type {
  LeverType,
  HaalbaarheidStatus,
  HaalbaarheidResultaat,
  SnijDeadlineConfig,
} from '../../../../supabase/functions/_shared/snij-haalbaarheid'
export {
  bepaalSnijDeadline,
  bepaalHaalbaarheidStatus,
  berekenHaalbaarheid,
} from '../../../../supabase/functions/_shared/snij-haalbaarheid'
