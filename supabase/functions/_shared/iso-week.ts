// ISO 8601 week-kern voor edge functions (Deno) — UTC-gebaseerd, TZ-onafhankelijk.
//
// Deno-spiegel van `frontend/src/lib/utils/iso-week.ts`. Houd beide kernen
// identiek. De overkoepelende waarheid blijft SQL:
// `to_char(date,'IYYY') || '-W' || to_char(date,'IW')` (mig 145/228).
//
// CONTRACT: alle functies lezen de UTC-componenten van de Date en strippen de
// tijdcomponent. Geef dus een Date waarvan het UTC-moment de bedoelde
// kalenderdatum is (bv. `new Date('2026-05-06T00:00:00Z')` of `Date.UTC(...)`).

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
