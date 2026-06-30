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
  fetchInkomendBerichtVoorOrder,
  fetchUitgaandeEdiBerichtenVoorOrder,
  type EdiBerichtListItem,
  type EdiBerichtenFilters,
  type EdiHandelspartnerConfig,
  type EdiBerichtStatus,
  type EdiRichting,
  type EdiBerichtType,
  type EdiBerichtDetail,
  type EdiUitgaandTijdlijnItem,
} from './queries/edi'

export { bevestigOrderViaEdi, bevestigOrderZonderEdiBericht } from './lib/bevestig-helper'
export { KARPI_GLN_DEFAULT } from './lib/karpi-fixed-width'
export { useBevestigEdiOrder } from './lib/use-bevestig-edi-order'

export {
  useEdiBerichten,
  useEdiBericht,
  useTeKoppelenEdiCount,
  useHandelspartnerConfig,
  useUpsertHandelspartnerConfig,
} from './hooks/use-edi'

export { EdiTeKoppelenBanner } from './components/te-koppelen-banner'
export { EdiAfleveradresOngekoppeldBanner } from './components/afleveradres-ongekoppeld-banner'

export { EdiBerichtenOverzichtPage } from './pages/berichten-overzicht'
export { EdiBerichtDetailPage } from './pages/bericht-detail'
export { UploadBerichtDialog } from './components/upload-bericht-dialog'
export { DemoBerichtDialog } from './components/demo-bericht-dialog'
export { EdiTag } from './components/edi-tag'
export { KlantEdiTab } from './components/klant-edi-tab'
