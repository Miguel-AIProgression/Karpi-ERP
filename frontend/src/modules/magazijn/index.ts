// Magazijn-module — pick-flow, pickbaarheid, locatie-mutaties.
// Smal publiek oppervlak: alleen wat externe consumers nodig hebben.
// Pure helpers (mapPickbaarheidRegel, comparePickShipOrders, bucketVoor, chunks)
// blijven module-private. Zie ADR-0002.

// Pages
export { MagazijnOverviewPage } from './pages/pick-overview'

// Hooks
export {
  usePickShipOrders,
  usePickShipStats,
  useUpdateMaatwerkLocatie,
  useUpdateRolLocatie,
} from './hooks/use-pick-ship'
export { useMagazijnLocaties } from './hooks/use-magazijn-locaties'

// Types
export type {
  PickShipOrder,
  PickShipRegel,
  PickShipBron,
  PickShipWachtOp,
  BucketKey,
  VervoerderSelectieStatus,
} from './lib/types'
