// Levertijd-Module — bezit het order-niveau levertijd_status-label, de fit-
// check ("haalt de klant-gevraagde week?") en de snelste-haalbaar-berekening
// (ADR-0020). Medium scope: types + cache seam in deze stap; hooks/queries/
// components/lib volgen in latere stappen. Cross-Module-imports gaan via deze
// barrel; directe imports uit subfolders worden door ESLint geblokkeerd
// conform Snijplanning- / Reservering- / Inkoop-precedent.

// ---------------------------------------------------------------------------
// Cache seam (cross-Module invalidation — ADR-0020)
// ---------------------------------------------------------------------------
export { invalidateNaLevertijdMutatie } from './cache'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type {
  LevertijdStatus,
  FitCheckResultaat,
  SnelsteHaalbaarResultaat,
} from './types'

// ---------------------------------------------------------------------------
// Hooks komen in stap 4
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Components komen in stap 5+
// ---------------------------------------------------------------------------
