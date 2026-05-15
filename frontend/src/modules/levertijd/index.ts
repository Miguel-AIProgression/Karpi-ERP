// Levertijd-Module — bezit het order-niveau levertijd_status-label, de fit-
// check ("haalt de klant-gevraagde week?") en de snelste-haalbaar-berekening
// (ADR-0020). Cross-Module-imports gaan via deze barrel; directe imports uit
// subfolders worden door ESLint geblokkeerd conform Snijplanning- /
// Reservering- / Inkoop-precedent.

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
// Hooks (stap 4)
// ---------------------------------------------------------------------------
export { useFitCheck } from './hooks/use-fit-check'
export type { UseFitCheckOptions } from './hooks/use-fit-check'
export { useSnelsteHaalbaar } from './hooks/use-snelste-haalbaar'
export { useLevertijdStatus } from './hooks/use-levertijd-status'
export { useNeemSnelsteOver } from './hooks/use-neem-snelste-over'
export type {
  NeemSnelsteOverInput,
  NeemSnelsteOverResult,
} from './hooks/use-neem-snelste-over'

// ---------------------------------------------------------------------------
// Queries — pure fetch-functies (RPC-wrappers + status-uitlees)
// ---------------------------------------------------------------------------
export {
  fetchFitCheck,
  fetchSnelsteHaalbaar,
  fetchLevertijdStatus,
} from './queries/levertijd'
export type { LevertijdStatusRow } from './queries/levertijd'

// ---------------------------------------------------------------------------
// Components (slot-components voor consumers — ADR-0020 Ingreep 5)
// ---------------------------------------------------------------------------
export { LevertijdStatusBadge } from './components/levertijd-status-badge'
export { LevertijdFitIndicator } from './components/levertijd-fit-indicator'
export { SnelsteHaalbaarKnop } from './components/snelste-haalbaar-knop'
