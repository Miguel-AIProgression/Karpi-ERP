// SnijVolgorde — operator-facing rij-gewijze snij-instructie voor één rol.
//
// Domein-model: een SnijVolgorde is wat de operator stap-voor-stap uitvoert
// op de guillotine-machine. Elke `Rij` is één breedte-mes-instelling; binnen
// een rij staan een of meer pieces met dezelfde Y-overlap (zelfde lengte-mes-
// pass) maar in aparte X-lanes (gescheiden door extra breedte-messen).
//
// Coordinate-conventie (consistent met de packer + snijplannen-schema):
//   * X-as = over rolbreedte; piece "lengte_cm" = X-extent
//   * Y-as = langs rollengte; piece "breedte_cm" = Y-extent
// Dit is misleidend t.o.v. dagelijks taalgebruik ("breedte × lengte" = X×Y),
// maar is de bestaande standaard in deze codebase.

import type { MaatwerkAfwerking, MaatwerkVorm } from '@/lib/types/productie'

export interface SnijVolgorde {
  rolnummer: string
  rol_breedte_cm: number  // X-as physical
  rol_lengte_cm: number   // Y-as physical
  rijen: Rij[]
  reststukken: ReststukMarker[]
  aangebroken_rest: AangebrokenMarker | null
  afval: AfvalRect[]
}

export interface Rij {
  rij_nummer: number                 // 1-based, incrementeert alleen voor snij-rijen
  breedte_messen_cm: number[]        // X-posities, sorted asc; primary = [0]
  is_breedte_mes_overgenomen: boolean // primary matcht vorige Rij's primary → "Mes laten staan"
  lengte_mes_cm: number              // INCREMENTAL Y-extent (niet absolute)
  lengte_mes_absoluut_cm: number     // absolute Y aan einde Rij (debug/visualisatie)
  pieces: KnifeOperation[]           // ordered by X-positie
}

export interface KnifeOperation {
  snijplan_id: number
  snijplan_nr: string
  // X-startpositie van het stuk binnen de rij (voor multi-lane).
  x_start_cm: number
  // Snij-maat: wat de mes-instelling fysiek snijdt (bestelde + marge).
  snij_maat_x_cm: number
  snij_maat_y_cm: number
  // Bestelde maat in originele klant-orientatie (sticker, hand-finishing target).
  bestelde_x_cm: number
  bestelde_y_cm: number
  bestelde_vorm: MaatwerkVorm
  bestelde_afwerking: MaatwerkAfwerking | null
  marge_cm: number
  // Afgeleide categorische instructie voor de hand-bewerking na het snijden.
  handeling: HandelingInstructie
  // Sticker / order info
  order_id: number
  order_nr: string
  klant_naam: string
  artikelnr: string | null
  afleverdatum: string | null
}

export type HandelingInstructie =
  | { kind: 'geen' }
  | { kind: 'orientatie_swap' }
  | { kind: 'rond_uitsnijden' }
  | { kind: 'ovaal_uitsnijden' }
  | { kind: 'zo_marge_extra'; marge_cm: number }

export interface ReststukMarker {
  letter: string                  // "R1", "R2", ...
  rolnummer_volledig: string      // "{rolnummer}-R{n}"
  breedte_cm: number              // X-extent
  lengte_cm: number               // Y-extent
  x_start_cm: number
  y_start_cm: number
}

export interface AangebrokenMarker {
  breedte_cm: number              // = rol_breedte_cm (volle breedte)
  lengte_cm: number               // resterende rollengte
  y_start_cm: number
}

export interface AfvalRect {
  breedte_cm: number              // X-extent
  lengte_cm: number               // Y-extent
  x_start_cm: number
  y_start_cm: number
}
