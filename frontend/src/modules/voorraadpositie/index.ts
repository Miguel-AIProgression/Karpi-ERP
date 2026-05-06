// Voorraadpositie-Module — barrel-export.
//
// Smal publiek oppervlak: types + fetchers + hooks + de kleur-helper
// (die meerdere callers nodig hebben voor consistentie tussen UI-input en
// queryKey-cache).
//
// T001 (mig 179): single-paar-modus — fetchVoorraadpositie + useVoorraadpositie.
// T003 (mig 180): batch+filter-modus — fetchVoorraadposities + useVoorraadposities.
//
// Past binnen ADR-0001: deep verticale Module met TS-functie-contract als seam.

export type {
  Voorraadpositie,
  UitwisselbarePartner,
  BesteldInkoop,
  VoorraadEigen,
  VoorraadpositieFilter,
} from './types'
export {
  fetchVoorraadpositie,
  fetchVoorraadposities,
} from './queries/voorraadposities'
export {
  useVoorraadpositie,
  useVoorraadposities,
} from './hooks/use-voorraadpositie'
export { normaliseerKleurcode } from './lib/normaliseer-kleur'
