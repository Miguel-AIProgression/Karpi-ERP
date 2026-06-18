// Re-export-shim: de gedeelde klanttaal-logica leeft sinds 2026-06-18 in
// _shared/klant-taal.ts (één bron voor orderbevestiging én factuur-PDF, ADR-0033).
// Bestaande imports `from './orderbevestiging-taal.ts'` blijven werken.
export { type Taal, bepaalTaal, vertaalOmschrijving } from './klant-taal.ts'
