// Public surface van de logistiek-module.
//
// Externe consumers (klanten-, orders-modules, router, sidebar) importeren bij
// voorkeur via deze barrel; interne imports binnen de module mogen direct
// verwijzen naar sub-folders.

export {
  VERVOERDER_REGISTRY,
  getVervoerderDef,
  type VervoerderCode,
  type VervoerderDef,
  type VervoerderType,
  type VervoerderBadgeKleur,
} from './registry'

export {
  fetchZendingen,
  fetchZendingMetTransportorders,
  fetchZendingPrintSet,
  createZendingVoorOrder,
  verstuurZendingOpnieuw,
  type ZendingAanmaakResult,
  type ZendingPrintSet,
  type ZendingPrintRegel,
  type ZendingPrintOrderRegel,
  type ZendingStatus,
  type HstTransportorderStatus,
  type ZendingenFilters,
} from './queries/zendingen'

export {
  fetchKlantVervoerderConfig,
  upsertKlantVervoerderConfig,
  fetchVervoerders,
  type VervoerderRow,
} from './queries/vervoerder-config'

export {
  useZendingen,
  useZending,
  useZendingPrintSet,
  useCreateZendingVoorOrder,
  useVerstuurZendingOpnieuw,
} from './hooks/use-zendingen'

export {
  useKlantVervoerderConfig,
  useUpsertKlantVervoerderConfig,
  useVervoerders,
} from './hooks/use-vervoerder-config'

export { ZendingenOverzichtPage } from './pages/zendingen-overzicht'
export { ZendingDetailPage } from './pages/zending-detail'
export { ZendingPrintSetPage } from './pages/zending-printset'
export { VervoerdersOverzichtPage } from './pages/vervoerders-overzicht'
export { VervoerderDetailPage } from './pages/vervoerder-detail'
export { VervoerderTag } from './components/vervoerder-tag'
export { VervoerderStatsCard } from './components/vervoerder-stats-card'
export { ZendingStatusBadge } from './components/zending-status-badge'
export { VerzendsetButton } from './components/verzendset-button'

// Fase A — vervoerder-instellingen (mig 174)
export {
  fetchVervoerders as fetchVervoerdersFull,
  fetchVervoerder,
  fetchVervoerderStats,
  fetchRecenteZendingenVervoerder,
  updateVervoerder,
  type Vervoerder,
  type VervoerderStats,
  type VervoerderUpdateInput,
  type RecenteZending,
} from './queries/vervoerders'
export {
  useVervoerders as useVervoerdersFull,
  useVervoerder,
  useVervoerderStats,
  useRecenteZendingenVervoerder,
  useUpdateVervoerder,
  useActieveVervoerder,
  type VervoerderSelectieStatus,
  type ActieveVervoerderResultaat,
} from './hooks/use-vervoerders'
export {
  useVervoerderForm,
  type VervoerderFormState,
} from './hooks/use-vervoerder-form'
