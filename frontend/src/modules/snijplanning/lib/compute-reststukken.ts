// Re-export-shim (ADR-0033) — de reststuk-geometrie-logica leeft éénmalig in
// supabase/functions/_shared/compute-reststukken.ts.
//
// Was tot 2026-07-02 een handmatig gesynchroniseerde 321-regel-kopie ("logica
// identiek" werd door mensen bewaakt, niet door de compiler — precies het
// SSCC-incident-patroon dat ADR-0033 verbiedt). De vier presentatie-varianten
// (…EnAfval, …FromStukken, …EnAfvalFromStukken, …AngebrokenAfval) bestonden
// alleen hier omdat de backend ze nooit nodig had; ze zijn bij deze migratie
// naar _shared verhuisd (niet gekopieerd) zodat er weer één bron is.
export * from '../../../../../supabase/functions/_shared/compute-reststukken'
