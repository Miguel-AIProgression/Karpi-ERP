// Debiteur-Module barrel — zie ADR-0011.
//
// Stap 3/8: queries + hooks beschikbaar via barrel; pages en components
// volgen in stap 4. Slot-tabs voor Orders en Prijslijst blijven tussentijds
// directe imports — gemarkeerd in ADR-0011 als technisch krediet.

// --- Slot-component voor cross-Module display ---
export { KlantBenaming } from './components/klant-benaming'
export { useKlantBenaming } from './hooks/use-klant-benaming'

// --- Debiteur-masterdata ---
export type { DebiteurRow, DebiteurDetail, Afleveradres } from './queries/debiteuren'
export {
  useDebiteuren,
  useDebiteurDetail,
  useAfleveradressen,
  useKlantArtikelnummers,
  useKlantPrijslijst,
  usePrijslijstHeadersList,
  useKoppelbareDebiteurenMetPrijslijst,
  useSetKlantPrijslijst,
  useSetKlantenPrijslijst,
} from './hooks/use-debiteuren'

// --- Klanteigen namen (admin-CRUD + resolver-data) ---
export type {
  KlanteigenRow,
  KlanteigenVoorKlantRow,
  KlanteigenVoorInkoopgroepRow,
  KlanteigenInsert,
} from './queries/klanteigen-namen'
export {
  fetchKlanteigenNaam,
  fetchKlanteigenNamenMap,
} from './queries/klanteigen-namen'
export {
  useKlanteigenVoorKlant,
  useKlanteigenVoorInkoopgroep,
  useKwaliteitCodes,
  useUpsertKlanteigenNaam,
  useUpdateKlanteigenNaam,
  useDeleteKlanteigenNaam,
} from './hooks/use-klanteigen-namen'

// --- Klant-artikelnummers (admin-CRUD) ---
export type { KlantArtikelnummer } from './queries/klant-artikelnummers'

// --- Klant-bound prijslijst-koppeling (pragma — verhuist bij Prijslijst-Module) ---
export type { PrijslijstRegel } from './queries/debiteur-prijslijst'

// --- Pages (router-imports) ---
export { DebiteurenOverviewPage } from './pages/debiteuren-overview'
export { DebiteurDetailPage } from './pages/debiteur-detail'
