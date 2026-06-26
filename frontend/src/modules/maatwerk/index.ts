// Maatwerk-Module barrel — zie ADR-0009.
export { berekenPrijsOppervlakM2, berekenOmtrekMeter } from './lib/oppervlak'
export { berekenMaatwerkPrijs } from './lib/prijs'
export { berekenMaatwerkAfleverdatumViaSeam } from './lib/leverdatum'

export {
  fetchVormen,
  fetchAfwerkingTypes,
  fetchTypeBewerkingen,
  fetchStandaardAfwerking,
  fetchAfwerkingVoorKleur,
  fetchAlleStandaardAfwerkingen,
  fetchMaatwerkKwaliteiten,
  fetchMaatwerkKleurenVoorKwaliteit,
  fetchMaatwerkKleurOptiesVoorKwaliteit,
  fetchMaatwerkKwaliteitOpties,
  fetchKoppelingenVoorKleurLabel,
  fetchKwaliteiten,
  fetchMaatwerkArtikelNr,
  fetchMaatwerkArtikelExact,
  fetchStandaardBandKleur,
  fetchBandDefaultsVoorKwaliteit,
  fetchKwaliteitM2Prijs,
  searchKwaliteitenViaProducten,
  searchDirecteProducten,
  fetchKleurenVoorKwaliteit,
  fetchStandaardMatenVoorKwaliteit,
  fetchMaatwerkLevertijdHint,
} from './queries/maatwerk-runtime'

export type {
  MaatwerkArtikelExact,
  MaatwerkVormRow,
  AfwerkingTypeRow,
  BandLabelKoppeling,
  BandDefault,
  BandDefaultRow,
  KwaliteitOptie,
  KleurOptie,
  DirectProductOptie,
  StandaardMaat,
  MaatwerkLevertijdHintResult,
} from './queries/maatwerk-runtime'

export {
  fetchAlleVormen,
  upsertVorm,
  deleteVorm,
  fetchAlleAfwerkingTypes,
  upsertAfwerkingType,
  deleteAfwerkingType,
  setStandaardAfwerking,
  setAfwerkingVoorKleur,
  clearStandaardAfwerking,
  setBandKleurDefault,
} from './queries/maatwerk-instellingen'

export { MaatwerkSelector } from './components/maatwerk-selector'
export { MaatwerkLevertijdHint } from './components/maatwerk-levertijd-hint'
export { KwaliteitFirstSelector } from './components/kwaliteit-first-selector'
export { KwaliteitKleurSelector } from './components/kwaliteit-kleur-selector'
export { VormAfmetingSelector } from './components/vorm-afmeting-selector'

export { VormFormDialog } from './components/vorm-form-dialog'
export { AfwerkingFormDialog } from './components/afwerking-form-dialog'
export { AfwerkingKleurKoppelingen } from './components/afwerking-kleur-koppelingen'
export { AfwerkingKleurenSubmenu } from './components/afwerking-kleuren-submenu'

export {
  useAlleVormen,
  useUpsertVorm,
  useDeleteVorm,
  useAlleAfwerkingen,
  useTypeBewerkingen,
  useUpsertAfwerking,
  useDeleteAfwerking,
} from './hooks/use-maatwerk-instellingen'

export { VormenInstellingenPage } from './pages/vormen-instellingen'
export { AfwerkingenInstellingenPage } from './pages/afwerkingen-instellingen'
