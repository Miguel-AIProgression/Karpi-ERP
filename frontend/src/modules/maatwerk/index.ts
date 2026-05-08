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
  fetchStandaardBandKleur,
  fetchBandDefaultsVoorKwaliteit,
  fetchKwaliteitM2Prijs,
  searchKwaliteitenViaProducten,
  fetchKleurenVoorKwaliteit,
  fetchStandaardMatenVoorKwaliteit,
  fetchMaatwerkLevertijdHint,
} from './queries/maatwerk-runtime'

export type {
  MaatwerkVormRow,
  AfwerkingTypeRow,
  BandLabelKoppeling,
  BandDefault,
  BandDefaultRow,
  KwaliteitOptie,
  KleurOptie,
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
