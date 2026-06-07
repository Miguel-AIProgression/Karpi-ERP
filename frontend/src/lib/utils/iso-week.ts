/**
 * ISO 8601 week-kern — UTC-gebaseerd, TZ-onafhankelijk.
 *
 * Single source of truth voor "welke ISO-week hoort bij deze datum" in de
 * frontend. Sluit 1-op-1 aan op de SQL-referentie
 * `to_char(date,'IYYY') || '-W' || to_char(date,'IW')` (mig 145/228) en op de
 * Deno-spiegel `supabase/functions/_shared/iso-week.ts`. Houd beide kernen
 * identiek — de SQL-functies zijn de overkoepelende waarheid.
 *
 * CONTRACT: alle functies lezen de UTC-componenten van de Date. Geef dus een
 * Date waarvan het UTC-moment de bedoelde kalenderdatum is — bv.
 * `new Date('2026-05-06T00:00:00Z')`, `new Date(Date.UTC(2026, 4, 6))`, of een
 * timestamp uit de DB (die al UTC is). Heb je een kale "YYYY-MM-DD"-string?
 * Gebruik dan `isoWeekJaarVanIso` / `isoWeekStringVanIso` — die verankeren zelf
 * op UTC-midnacht zodat lokale tijdzone het weeknummer nooit verschuift.
 *
 * Vóór deze consolidatie bestonden er ≥6 frontend-kopieën, deels op lokale tijd —
 * een latente off-by-one rond middernacht/jaargrens op een leverbelofte-veld.
 */

export interface IsoWeekJaar {
  jaar: number
  week: number
}

const DAG_MS = 86_400_000

/** ISO-week + ISO-jaar (week 1 hoort bij het jaar dat de donderdag bevat). UTC. */
export function isoWeekJaar(d: Date): IsoWeekJaar {
  const x = new Date(d.getTime())
  x.setUTCHours(0, 0, 0, 0) // tijdcomponent strippen — anders lekt die in de dag-aritmetiek
  const dagNum = x.getUTCDay() || 7 // ma=1 .. zo=7
  // Donderdag van deze ISO-week bepaalt het ISO-jaar.
  x.setUTCDate(x.getUTCDate() + 4 - dagNum)
  const jaarStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((x.getTime() - jaarStart.getTime()) / DAG_MS + 1) / 7)
  return { jaar: x.getUTCFullYear(), week }
}

/** ISO-weeknummer (1-53). UTC. */
export function isoWeek(d: Date): number {
  return isoWeekJaar(d).week
}

/** Sorteer-/sleutel-string "YYYY-Www" (zero-padded, matcht SQL `to_char IW`). */
export function isoWeekString(d: Date): string {
  const { jaar, week } = isoWeekJaar(d)
  return `${jaar}-W${String(week).padStart(2, '0')}`
}

/** Maandag (UTC-midnacht) van de ISO-week waarin `d` valt. */
export function isoWeekMaandag(d: Date): Date {
  const x = new Date(d.getTime())
  x.setUTCHours(0, 0, 0, 0)
  const dagNum = x.getUTCDay() || 7
  x.setUTCDate(x.getUTCDate() - (dagNum - 1))
  return x
}

/** Maandag van (jaar, week) als UTC-midnacht Date. Inverse van `isoWeekJaar`. */
export function maandagVanIsoWeek(jaar: number, week: number): Date {
  // 4 januari valt per ISO-definitie altijd in week 1 → anker.
  const jan4 = new Date(Date.UTC(jaar, 0, 4))
  const maandagWeek1 = isoWeekMaandag(jan4)
  const out = new Date(maandagWeek1)
  out.setUTCDate(maandagWeek1.getUTCDate() + (week - 1) * 7)
  return out
}

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
 * Bewust NIET in de Deno-spiegel: edge functions draaien in UTC, daar is lokaal == UTC.
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
