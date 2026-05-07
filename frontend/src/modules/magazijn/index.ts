// Magazijn-module — pick-flow, pickbaarheid, locatie-mutaties.
// Smal publiek oppervlak: alleen wat externe consumers nodig hebben.
// Pure helpers (mapPickbaarheidRegel, comparePickShipOrders, bucketVoor, chunks)
// blijven module-private. Zie ADR-0002.

// Pages
export { MagazijnOverviewPage } from './pages/pick-overview'
export { PickProblemenPage } from './pages/pick-problemen'

// Hooks
export {
  usePickShipOrders,
  usePickShipStats,
  useUpdateMaatwerkLocatie,
  useUpdateRolLocatie,
} from './hooks/use-pick-ship'
export { useMagazijnLocaties } from './hooks/use-magazijn-locaties'

export {
  useColliVoorZending,
  usePickProblemen,
  useStartPickronde,
  useMarkeerColliNietGevonden,
  useVoltooiPickronde,
} from './hooks/use-pickronde'

// Types — VervoerderSelectieStatus zit niet meer hier; magazijn weet niets
// over vervoerders meer. Zie modules/logistiek voor self-fetching VervoerderTag.
export type {
  PickShipOrder,
  PickShipRegel,
  PickShipBron,
  PickShipWachtOp,
  BucketKey,
} from './lib/types'

export type {
  PickColliRij,
  PickProbleemRij,
  NietGevondenModus,
  MarkeerNietGevondenArgs,
} from './queries/pickronde'
