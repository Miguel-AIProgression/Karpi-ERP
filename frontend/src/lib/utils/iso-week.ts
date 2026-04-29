/**
 * ISO 8601 week-of-year helpers.
 *
 * Bron-van-waarheid voor week-uit-datum berekeningen in de UI. Gebruik deze
 * helpers ipv inline berekeningen — de DB-zijde gebruikt `iso_week_plus()`
 * (migratie 145) en de UI-zijde moet daarmee consistent zijn.
 */

/** Returnt het ISO-weeknummer (1-53) voor een datum. */
export function isoWeek(date: Date): number {
  const target = new Date(date.getTime())
  target.setHours(0, 0, 0, 0)
  // Donderdag in deze week bepaalt het weeknummer
  target.setDate(target.getDate() + 4 - (target.getDay() || 7))
  const yearStart = new Date(target.getFullYear(), 0, 1)
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

/** Returnt 'YYYY-Www' voor een datum (parseable in ISO-string from DB). */
export function isoWeekString(date: Date): string {
  const target = new Date(date.getTime())
  target.setHours(0, 0, 0, 0)
  target.setDate(target.getDate() + 4 - (target.getDay() || 7))
  const week = isoWeek(date)
  return `${target.getFullYear()}-W${String(week).padStart(2, '0')}`
}

/** Returnt het ISO-weeknummer voor een ISO-datumstring (YYYY-MM-DD). */
export function isoWeekFromString(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null
  const d = new Date(isoDate)
  if (Number.isNaN(d.getTime())) return null
  return String(isoWeek(d))
}
