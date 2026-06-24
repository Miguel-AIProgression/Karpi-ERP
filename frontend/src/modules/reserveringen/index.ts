// Reservering-Module — bezit het claim-eigendom (tabel `order_reserveringen`),
// allocator-spiegels, levertijd-view-queries en de claim-related runtime-components.
// Medium scope (ADR-0015): logica-laag + components leven hier. Geen barrel-
// exports van losse query-functies — alleen via hooks naar buiten (Snijplanning-
// precedent ADR-0013) zodat callers React Query-cache disciplines respecteren.

// ---------------------------------------------------------------------------
// Types (queries)
// ---------------------------------------------------------------------------
export type {
  OrderRegelLevertijd,
  OrderClaim,
  IORegelClaim,
  ClaimBron,
  ClaimStatus,
  LevertijdStatus,
  LeverModus,
  HandmatigeKeuzePerRegel,
} from './queries/reserveringen'
export type { AllocatieOptie } from './queries/allocatie-opties'
export type { AllocatieKeuze } from '@/lib/supabase/queries/order-mutations'

// ---------------------------------------------------------------------------
// Types + pure helpers (lib)
// ---------------------------------------------------------------------------
export type { RegelDekking } from './lib/dekking-preview'
export { berekenRegelDekking } from './lib/dekking-preview'

// ---------------------------------------------------------------------------
// Hooks (queries)
// ---------------------------------------------------------------------------
export {
  useLevertijdVoorOrder,
  useClaimsVoorOrder,
  useClaimsVoorOrderRegel,
  useClaimsVoorIORegel,
  useHandmatigeKeuzesVoorOrder,
  useAllocatieOpties,
} from './hooks/use-reserveringen'

// ---------------------------------------------------------------------------
// Components (claim-related runtime UI — leven op de types die deze Module bezit)
// ---------------------------------------------------------------------------
export { RegelClaimDetail } from './components/regel-claim-detail'
export { SubstitutionPicker } from './components/substitution-picker'
export { UitwisselbaarTekortHint } from './components/uitwisselbaar-tekort-hint'
export { UitwisselbaarToepassenRij } from './components/uitwisselbaar-toepassen-rij'
export { OntgrendelAllocatieKeuzeRij } from './components/ontgrendel-allocatie-rij'
export { LevertijdBadge } from './components/levertijd-badge'

// ---------------------------------------------------------------------------
// Cache seam (cross-Module invalidation — ADR-0015, Ingreep 5)
// ---------------------------------------------------------------------------
export { invalidateNaReserveringsmutatie } from './cache'
