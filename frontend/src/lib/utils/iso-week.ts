/**
 * ISO 8601 week-helpers voor de frontend.
 *
 * De kern (isoWeekJaar/isoWeek/isoWeekString/isoWeekMaandag/maandagVanIsoWeek)
 * leeft in supabase/functions/_shared/iso-week.ts en wordt hier cross-root
 * ge-re-exporteerd (ADR-0033) — één implementatie voor edge én frontend.
 * Hieronder alleen frontend-only uitbreidingen: week-ranges voor UI-headers,
 * en wall-clock/"YYYY-MM-DD"-parsing die op UTC-midnacht verankert zodat de
 * lokale tijdzone het weeknummer nooit verschuift (edge draait in UTC en
 * heeft die verankering niet nodig).
 *
 * CONTRACT (kern): functies lezen UTC-componenten — wall-clock "nu"? Eerst
 * door `lokaleDatumAlsUtc` halen, anders schuift de ISO-week rond middernacht.
 */

import { isoWeekJaar, isoWeekString, maandagVanIsoWeek } from '../../../../supabase/functions/_shared/iso-week'
import type { IsoWeekJaar } from '../../../../supabase/functions/_shared/iso-week'

export * from '../../../../supabase/functions/_shared/iso-week'

/** Maandag→zondag (UTC-midnacht) voor (jaar, week) — t.b.v. week-headers. */
export function isoWeekRange(jaar: number, week: number): { van: Date; tot: Date } {
  const van = maandagVanIsoWeek(jaar, week)
  const tot = new Date(van)
  tot.setUTCDate(van.getUTCDate() + 6)
  return { van, tot }
}

/**
 * UTC-verankerde Date van de LOKALE kalenderdatum van `d`. Bedoeld voor een
 * wall-clock instant (`new Date()` = "nu"): de kern leest UTC-componenten, dus
 * een rauwe `new Date()` zou in NL (UTC+1/+2) tussen lokaal 00:00 en 02:00 op de
 * vóórgaande UTC-dag landen → verkeerde ISO-week. Door eerst de lokale
 * kalenderdatum te nemen en die op UTC-midnacht te verankeren, vergelijkt "nu"
 * correct met een `afleverdatum`-DATE (die ook op UTC-midnacht verankerd wordt).
 *
 * Bewust NIET in de Deno-bron: edge functions draaien in UTC, daar is lokaal == UTC.
 */
export function lokaleDatumAlsUtc(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
}

/**
 * Parse "YYYY-MM-DD" (of een volledige ISO-timestamp) naar een UTC-verankerde
 * Date, of `null` bij ontbrekende/ongeldige input. Een kale datum krijgt
 * `T00:00:00Z` zodat de lokale tijdzone het weeknummer niet verschuift.
 */
function utcVanIso(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** ISO-week+jaar voor een "YYYY-MM-DD"-string (of ISO-timestamp), of null. */
export function isoWeekJaarVanIso(iso: string | null | undefined): IsoWeekJaar | null {
  const d = utcVanIso(iso)
  return d ? isoWeekJaar(d) : null
}

/** "YYYY-Www" voor een "YYYY-MM-DD"-string, of null. */
export function isoWeekStringVanIso(iso: string | null | undefined): string | null {
  const d = utcVanIso(iso)
  return d ? isoWeekString(d) : null
}

/**
 * Backwards-compat: enkel het ISO-weeknummer als string voor een YYYY-MM-DD
 * datum (voedt "wk {n}"-labels). Nieuwe code: gebruik `isoWeekJaarVanIso`.
 */
export function isoWeekFromString(iso: string | null | undefined): string | null {
  const w = isoWeekJaarVanIso(iso)
  return w ? String(w.week) : null
}
