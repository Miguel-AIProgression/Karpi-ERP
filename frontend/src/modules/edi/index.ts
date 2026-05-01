// Public surface van de EDI-module.
//
// Externe consumers (klanten-, orders-modules, router, sidebar) importeren bij
// voorkeur via deze barrel; interne imports binnen de module mogen direct
// verwijzen naar sub-folders.

export {
  BERICHTTYPE_REGISTRY,
  getBerichttypenVoorRichting,
  getBerichttypeDef,
  type Berichttype,
  type BerichttypeDef,
  type ConfigToggleKey,
  type Richting,
  type RelatedEntity,
} from './registry'

export {
  fetchEdiBerichten,
  fetchEdiBericht,
  fetchHandelspartnerConfig,
  upsertHandelspartnerConfig,
  ruimEdiDemoData,
  type EdiBerichtListItem,
  type EdiBerichtenFilters,
  type EdiHandelspartnerConfig,
  type EdiBerichtStatus,
  type EdiRichting,
  type EdiBerichtType,
} from './queries/edi'

export {
  useEdiBerichten,
  useEdiBericht,
  useHandelspartnerConfig,
  useUpsertHandelspartnerConfig,
} from './hooks/use-edi'

export { EdiBerichtenOverzichtPage } from './pages/berichten-overzicht'
export { EdiBerichtDetailPage } from './pages/bericht-detail'
export { UploadBerichtDialog } from './components/upload-bericht-dialog'
export { DemoBerichtDialog } from './components/demo-bericht-dialog'
export { EdiTag } from './components/edi-tag'
export { KlantEdiTab } from './components/klant-edi-tab'
