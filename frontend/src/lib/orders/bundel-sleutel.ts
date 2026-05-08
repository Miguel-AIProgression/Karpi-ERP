// Bundel-sleutel voor zending-bundeling — TypeScript-spiegel van SQL-functie
// `bundel_sleutel(debiteur_nr, adres_norm, vervoerder, jaar_week)` uit
// migratie 228. Bundel-sleutel = de identiteit waarop orders worden
// gegroepeerd in 1 zending → 1 pakbon → 1× transportbeweging.
//
// 4 dimensies:
//   1. debiteur_nr  — bundel kruist nooit klant-grens
//   2. adres_norm   — genormaliseerd afleveradres (zie normaliseer-adres.ts)
//   3. vervoerder   — effectieve vervoerder uit mig 219/225-ladder, of 'AFHAAL'
//   4. jaar_week    — ISO-week van afleverdatum (zie verzendweek.ts)
//
// Wijzigt één dimensie → andere sleutel → orders splitsen automatisch.
//
// **Single source of truth**: deze functie en de SQL-versie in mig 228 moeten
// identieke output geven. Bij wijzigingen beide kanten tegelijk landen,
// anders divergeren UI-clustering en DB-validatie (waardoor de UI een bundel
// laat zien die `start_pickronden_bundel` zou afwijzen).

import { verzendWeekIsoString } from './verzendweek'
import { normaliseerAdresKey } from './normaliseer-adres'

export interface BundelSleutelInput {
  debiteur_nr: number
  adres_norm: string
  vervoerder_code: string | null
  jaar_week: string | null
}

export function bundelSleutel(input: BundelSleutelInput): string {
  const v = input.vervoerder_code && input.vervoerder_code.trim() !== ''
    ? input.vervoerder_code
    : 'GEEN'
  const w = input.jaar_week && input.jaar_week.trim() !== ''
    ? input.jaar_week
    : 'GEEN'
  const a = input.adres_norm && input.adres_norm.trim() !== ''
    ? input.adres_norm
    : '?'
  return `D${input.debiteur_nr}|V${v}|W${w}|A${a}`
}

/**
 * Convenience-wrapper: bouw de sleutel direct uit ruwe order-velden. Past de
 * adres-normalisatie + week-afleiding zelf toe — gebruik dit als je de inputs
 * los hebt liggen (Pick & Ship UI). Voor pre-genormaliseerde inputs (uit de
 * `voorgestelde_zending_bundels`-view) is `bundelSleutel` directer.
 */
export function bundelSleutelVoorOrder(input: {
  debiteur_nr: number
  afl_adres: string | null
  afl_postcode: string | null
  afl_land: string | null
  afleverdatum: string | null
  vervoerder_code: string | null
  afhalen?: boolean
}): string {
  return bundelSleutel({
    debiteur_nr: input.debiteur_nr,
    adres_norm: normaliseerAdresKey(input),
    vervoerder_code: input.afhalen ? 'AFHAAL' : input.vervoerder_code,
    jaar_week: verzendWeekIsoString(input.afleverdatum) || null,
  })
}
