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
  startPickrondes,
  verstuurZendingOpnieuw,
  type ZendingAanmaakResult,
  type ZendingPrintSet,
  type ZendingPrintRegel,
  type ZendingPrintOrderRegel,
  type ZendingStatus,
  type HstTransportorderStatus,
  type ZendingenFilters,
} from './queries/zendingen'

// vervoerder-config (klant-fallback) is verwijderd in ADR-0008 — zie queries/vervoerder-keuze

export {
  useZendingen,
  useZending,
  useZendingPrintSet,
  useStartPickrondes,
  useVerstuurZendingOpnieuw,
} from './hooks/use-zendingen'

// use-vervoerder-config (klant-fallback hooks) verwijderd in ADR-0008

export { ZendingenOverzichtPage } from './pages/zendingen-overzicht'
export { ZendingDetailPage } from './pages/zending-detail'
export { ZendingPrintSetPage } from './pages/zending-printset'
export { BulkPrintSetPage } from './pages/bulk-printset'
export { VervoerdersOverzichtPage } from './pages/vervoerders-overzicht'
export { VervoerderDetailPage } from './pages/vervoerder-detail'
export { HstMonitorPanel } from './components/hst-monitor-panel'
export { HstAandachtBanner } from './components/hst-aandacht-banner'
export { VervoerderTag } from './components/vervoerder-tag'
export { VervoerderInlineSelect } from './components/vervoerder-inline-select'
export { VervoerderOrderregelPill } from './components/vervoerder-orderregel-pill'
export { VervoerderStatsCard } from './components/vervoerder-stats-card'
export {
  VervoerderFilterButton,
  type VervoerderFilterValue,
} from './components/vervoerder-filter-button'
// Mig 248 (ADR-0012): ResolvedVervoerder is verhuisd van magazijn/bundel-cluster
// naar logistiek/lib/resolved-vervoerder (bundel-cluster is gedropt).
export type { ResolvedVervoerder } from './lib/resolved-vervoerder'
export {
  useEffectieveVervoerderPerOrderregel,
  useUpdateOrderregelVervoerderOverride,
  type OrderregelVervoerder,
} from './hooks/use-orderregel-vervoerder'
export {
  useVervoerderKeuzeVoorOrder,
  useSetOrderVervoerderOverride,
  type BulkOverrideResultaat,
  type OrderVervoerderAggregaat,
} from './hooks/use-vervoerder-keuze'
export { VervoerderResolutieProvider } from './context/vervoerder-resolutie-provider'
export {
  useVervoerderResolutieContext,
  useEffectieveVervoerderVoorOrders,
} from './context/vervoerder-resolutie-context'
export { ZendingStatusBadge } from './components/zending-status-badge'
export { StartPickrondesButton } from './components/start-pickrondes-button'
export { StartWeekButton } from './components/start-week-button'
export { usePickbaarheid, type PickbaarheidResultaat } from './hooks/use-pickbaarheid'

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
