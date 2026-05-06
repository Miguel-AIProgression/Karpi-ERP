// Voorraadpositie-Module — barrel-export.
//
// Smal publiek oppervlak: types + één fetcher + één hook + de kleur-helper
// (die meerdere callers nodig hebben voor consistentie tussen UI-input en
// queryKey-cache). T003 (#28) breidt dit uit met fetchVoorraadposities +
// useVoorraadposities (batch+filter).
//
// Past binnen ADR-0001: deep verticale Module met TS-functie-contract als seam.

export type {
  Voorraadpositie,
  UitwisselbarePartner,
  BesteldInkoop,
  VoorraadEigen,
} from './types'
export { fetchVoorraadpositie } from './queries/voorraadposities'
export { useVoorraadpositie } from './hooks/use-voorraadpositie'
export { normaliseerKleurcode } from './lib/normaliseer-kleur'
