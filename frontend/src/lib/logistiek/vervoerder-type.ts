// Re-export-shim (ADR-0033): de implementatie leeft in
// supabase/functions/_shared/vervoerders/vervoerder-type.ts — spiegelt de
// DB-CHECK `vervoerders_type_check` (mig 424), één bron voor alle drie de
// voorheen onderling afwijkende `VervoerderType`-unions.
export * from '../../../../supabase/functions/_shared/vervoerders/vervoerder-type'
