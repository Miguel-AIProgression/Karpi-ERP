// Re-export-shim (ADR-0033): de pure presentatielogica leeft in
// supabase/functions/_shared/afwerking-presentatie.ts — één bron voor edge én
// frontend. `fetchAfwerkingTypeMap` (Deno-IO) wordt hier bewust niet
// re-exporteerd; de frontend bouwt zijn eigen map uit de al bestaande
// `fetchAfwerkingTypes()` (@/modules/maatwerk/queries/maatwerk-runtime).
export {
  afwerkingPresentatie,
  type AfwerkingInfo,
  type AfwerkingTypeMap,
} from '../../../../supabase/functions/_shared/afwerking-presentatie'
