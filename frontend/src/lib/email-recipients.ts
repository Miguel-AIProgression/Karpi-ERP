// Re-export-shim (ADR-0033): de implementatie leeft in
// supabase/functions/_shared/email-list.ts — één bron voor edge én frontend.
// Bestaat alleen zodat consumers het vertrouwde @/lib-pad houden.
export * from '../../../supabase/functions/_shared/email-list'
