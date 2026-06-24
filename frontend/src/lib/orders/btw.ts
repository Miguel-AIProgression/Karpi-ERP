// Cross-root re-export van de BTW-seam (ADR-0033). De pure logica leeft éénmaal
// in supabase/functions/_shared/btw.ts (spiegelt de SQL-bron effectief_btw_pct /
// is_eu_land / bepaal_btw_regeling, mig 371/454-456) — nooit kopiëren.
export * from '../../../../supabase/functions/_shared/btw'
