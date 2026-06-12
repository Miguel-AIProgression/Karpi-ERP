// Re-export-shim (ADR-0033): de implementatie leeft in
// supabase/functions/_shared/vervoerder-eisen.ts — één bron voor edge én
// frontend. Nog geen frontend-consumers; gereserveerd voor de Pick & Ship-
// waarschuwingsvlag (ADR-0030).
export * from '../../../../supabase/functions/_shared/vervoerder-eisen'
