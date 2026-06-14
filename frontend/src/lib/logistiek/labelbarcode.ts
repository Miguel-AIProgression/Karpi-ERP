// Re-export-shim (ADR-0033): de implementatie leeft in
// supabase/functions/_shared/vervoerders/labelbarcode.ts — één bron voor de
// label-render (shipping-label.tsx) én alle carrier-payloads (HST/Verhoek/
// Rhenus). De AI(00)-prefix mag nooit per consument afwijken.
export * from '../../../../supabase/functions/_shared/vervoerders/labelbarcode'
