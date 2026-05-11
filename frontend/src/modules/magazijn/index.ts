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

// Mig 248 (ADR-0012): `bundel-cluster.ts` is verwijderd. Frontend-clustering
// gebeurt vóór de RPC-call alleen nog SQL-side via `voorgestelde_zending_bundels`
// (mig 229) — de RPC `start_pickronden` doet zelf de 4D-uitbreiding en
// groepering. Externe consumers van deze module hoeven geen vervoerder-resolutie
// meer te kennen vóór ze pickrondes starten.
