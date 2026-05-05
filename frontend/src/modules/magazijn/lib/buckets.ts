import type { BucketKey } from './types'

/** Geeft maandag van de ISO-week waarin `d` valt (lokale tijd, midnacht). */
function isoMaandag(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dag = x.getDay() // 0 = zo, 1 = ma, ..., 6 = za
  const offset = dag === 0 ? -6 : 1 - dag
  x.setDate(x.getDate() + offset)
  return x
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function diffDagen(a: Date, b: Date): number {
  const ms = startOfDay(a).getTime() - startOfDay(b).getTime()
  return Math.round(ms / 86_400_000)
}

/**
 * Bepaalt in welke pick-ship-bucket een afleverdatum valt t.o.v. vandaag.
 */
export function bucketVoor(
  afleverdatumIso: string | null,
  vandaag: Date = new Date()
): BucketKey {
  if (!afleverdatumIso) return 'geen_datum'
  const al = new Date(afleverdatumIso + 'T00:00:00')
  const v = startOfDay(vandaag)
  const d = diffDagen(al, v)
  if (d < 0) return 'achterstallig'
  if (d === 0) return 'vandaag'
  if (d === 1) return 'morgen'

  const maandagDezeWeek = isoMaandag(v)
  const maandagVolgendeWeek = new Date(maandagDezeWeek)
  maandagVolgendeWeek.setDate(maandagDezeWeek.getDate() + 7)
  const maandagOverVolgende = new Date(maandagDezeWeek)
  maandagOverVolgende.setDate(maandagDezeWeek.getDate() + 14)

  if (al < maandagVolgendeWeek) return 'deze_week'
  if (al < maandagOverVolgende) return 'volgende_week'
  return 'later'
}
