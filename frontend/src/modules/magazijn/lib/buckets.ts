// Pick & Ship-bucket-logica. Verzendweek-helpers komen uit het orderdomein-seam
// (lib/orders/verzendweek) — zo blijft "wanneer gaat dit naar buiten" één
// definitie voor alle modules. Hier zit alleen de magazijn-specifieke vraag:
// in welke verzendweek-tab valt deze order t.o.v. vandaag?
import { isoMaandag, isoWeek, verzendWeekDiff } from '@/lib/orders/verzendweek'
import { lokaleDatumAlsUtc } from '@/lib/utils/iso-week'
import type { BucketKey } from './types'

/**
 * Bepaalt de pick-bucket op basis van het verschil in ISO-weken tussen vandaag
 * en de verzendweek van de order.
 *
 * - diff ≤ 1                → 'wk_1' (eerstvolgende verzendweek; bevat ook de
 *                              huidige verzendweek + achterstallige orders)
 * - diff = 2..5             → 'wk_2'..'wk_5'
 * - diff ≥ 6 OF geen datum  → 'later'
 */
export function bucketVoor(
  afleverdatumIso: string | null,
  vandaag: Date = new Date()
): BucketKey {
  if (!afleverdatumIso) return 'later'

  const datum = new Date(afleverdatumIso + 'T00:00:00Z')
  const diff = verzendWeekDiff(lokaleDatumAlsUtc(vandaag), datum)
  if (diff <= 1) return 'wk_1'
  if (diff === 2) return 'wk_2'
  if (diff === 3) return 'wk_3'
  if (diff === 4) return 'wk_4'
  if (diff === 5) return 'wk_5'
  return 'later'
}

export interface WeekTabDef {
  key: BucketKey
  /** Tab-label, bv. "Week 19" of "Later". Toont de PICK-week, niet de
   *  verzendweek — Karpi-vuistregel: picken gebeurt 1 week vóór verzenden. */
  label: string
  /** ISO-weeknummer (pick-week) voor week-tabs; null voor 'later'. */
  weeknr: number | null
  /** ISO-jaar (van de pick-week) voor week-tabs; null voor 'later'. */
  jaar: number | null
}

/**
 * Genereert de tab-definities op basis van vandaag: vijf pick-weken
 * (huidige_week t/m huidige_week + 4) plus een "Later"-tab.
 *
 * Tabs labelen op pick-week — niet op verzendweek. De pick-week is wat de
 * magazijnier in zijn agenda heeft staan ("deze week pick ik X"); de
 * verzendweek volgt 1 week later. `wk_1` = huidige pick-week (= huidige ISO-
 * week) en bevat orders met verzendweek `huidige_week + 1` of eerder
 * (incl. achterstallig).
 */
export function genereerWeekTabs(vandaag: Date = new Date()): WeekTabDef[] {
  const tabs: WeekTabDef[] = []
  const ma = isoMaandag(lokaleDatumAlsUtc(vandaag)) // lokale "vandaag" → UTC-midnacht maandag.
  for (let i = 1; i <= 5; i++) {
    const datum = new Date(ma)
    // i = 1 → huidige pick-week (offset 0); i = 5 → pick-week + 4.
    datum.setUTCDate(ma.getUTCDate() + 7 * (i - 1))
    const w = isoWeek(datum)
    tabs.push({
      key: `wk_${i}` as BucketKey,
      label: `Week ${w.week}`,
      weeknr: w.week,
      jaar: w.jaar,
    })
  }
  tabs.push({ key: 'later', label: 'Later', weeknr: null, jaar: null })
  return tabs
}

// Re-export verzendweek-helpers zodat magazijn-consumers één import-locatie hebben.
// Bron blijft `lib/orders/verzendweek` — hier alleen voor consumer-ergonomie.
export {
  verzendWeekVoor,
  verzendWeekSleutel,
  verzendWeekLabel,
  verzendWeekKort,
} from '@/lib/orders/verzendweek'
