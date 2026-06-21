// ----------------------------------------------------------------------------
// Dunne re-export-shim — géén eigen rekenkunde (ADR-0033, patroon snij-haalbaarheid.ts).
// ----------------------------------------------------------------------------
// `leverdatumVoorSnijDatum` is de voorwaartse tegenhanger van `bepaalSnijDeadline`
// (snij-haalbaarheid.ts): geeft een snij-datum + buffer, bereken de (realistische)
// leverdatum. Leeft in supabase/functions/_shared/levertijd-match.ts (gebruikt door
// check-levertijd) — hier direct geïmporteerd i.p.v. gekopieerd.

export { leverdatumVoorSnijDatum } from '../../../../supabase/functions/_shared/levertijd-match'
