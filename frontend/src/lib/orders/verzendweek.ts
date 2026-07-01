// Verzendweek-seam voor het orderdomein.
//
// In Karpi-context is `orders.afleverdatum` semantisch eigenlijk de VERZENDDATUM:
// een order met afleverdatum 06-05 wordt verzonden in de week van 06-05 (= week 19).
// Niet de exacte dag is leidend voor magazijn/logistiek, maar de week.
//
// Deze helpers zijn de single source of truth voor "wanneer gaat dit naar buiten":
// magazijn (pick & ship), logistiek (zendingen), en order-UI consumeren ze allemaal.
// Verandert ooit de mapping van afleverdatum → verzendweek (bv. shift van 1 week
// voor specifieke vervoerders), dan gebeurt dat hier en nergens anders.

import {
  isoWeekJaar,
  isoWeekMaandag,
  lokaleDatumAlsUtc,
  type IsoWeekJaar,
} from '@/lib/utils/iso-week'

// De ISO-week-rekenkern woont in `lib/utils/iso-week.ts` (UTC-correct). Hier
// blijven alleen de Karpi-domeinhelpers (NL-labels, pick-week-regels). De
// onderstaande re-exports houden bestaande consumenten (o.a. buckets.ts) en de
// verzendweek-regressietest werkend zonder eigen weekberekening.

/** ISO-week + ISO-jaar van een Date. Domein-alias voor `isoWeekJaar` (UTC). */
export const isoWeek = isoWeekJaar

/** Maandag (UTC-midnacht) van de ISO-week waarin `d` valt. Alias voor de kern. */
export const isoMaandag = isoWeekMaandag

/** Verzendweek voor een order. Mapt 1:1 op de ISO-week van afleverdatum. */
export function verzendWeekVoor(
  afleverdatumIso: string | null
): IsoWeekJaar | null {
  if (!afleverdatumIso) return null
  return isoWeekJaar(new Date(afleverdatumIso + 'T00:00:00Z'))
}

/** Sorteersleutel "YYYY-Www" voor stabiele sortering over jaarwisseling. */
export function verzendWeekSleutel(afleverdatumIso: string | null): string {
  const w = verzendWeekVoor(afleverdatumIso)
  if (!w) return '9999-W99'
  return `${w.jaar}-W${String(w.week).padStart(2, '0')}`
}

/** Vol label voor groepskoppen, bv. "Verzendweek 19". */
export function verzendWeekLabel(afleverdatumIso: string | null): string {
  const w = verzendWeekVoor(afleverdatumIso)
  if (!w) return 'Geen datum'
  return `Verzendweek ${w.week}`
}

/** Compact label voor kaarten/tags, bv. "Wk 19". */
export function verzendWeekKort(afleverdatumIso: string | null): string {
  const w = verzendWeekVoor(afleverdatumIso)
  if (!w) return 'Geen datum'
  return `Wk ${w.week}`
}

/**
 * ISO week-string in HTML5 `<input type="week">`-formaat: "2026-W19".
 * Lege string als datum ontbreekt — zo bind je hem direct aan een input value.
 */
export function verzendWeekIsoString(afleverdatumIso: string | null): string {
  const w = verzendWeekVoor(afleverdatumIso)
  if (!w) return ''
  return `${w.jaar}-W${String(w.week).padStart(2, '0')}`
}

/**
 * Inverse van `verzendWeekIsoString`: parseert "YYYY-Www" naar de vrijdag-datum
 * van die ISO-week (YYYY-MM-DD). Vrijdag is gekozen omdat dat de typische
 * laatste werkdag is — geeft maximale lead-tijd binnen de week en sluit aan
 * bij hoe het magazijn de "verzendweek" leeft.
 *
 * Retourneert null bij ongeldige input. Werkt correct rond jaarwisseling
 * doordat ISO-week 1 altijd 4 januari bevat.
 */
export function verzendWeekStringToDatum(weekStr: string): string | null {
  const m = weekStr.match(/^(\d{4})-W(\d{1,2})$/)
  if (!m) return null
  const jaar = Number.parseInt(m[1], 10)
  const week = Number.parseInt(m[2], 10)
  if (week < 1 || week > 53) return null
  // 4 januari valt per ISO-definitie altijd in week 1 → anker voor week-aritmetiek.
  const jan4 = new Date(Date.UTC(jaar, 0, 4))
  const dagNum = jan4.getUTCDay() || 7
  const maandagWeek1 = new Date(jan4)
  maandagWeek1.setUTCDate(jan4.getUTCDate() + 1 - dagNum)
  const vrijdag = new Date(maandagWeek1)
  vrijdag.setUTCDate(maandagWeek1.getUTCDate() + (week - 1) * 7 + 4)
  return vrijdag.toISOString().slice(0, 10)
}

/**
 * Aantal ISO-weken tussen twee datums (vergelijkt maandag-van-de-week, dus
 * ongevoelig voor de exacte dag binnen de week). Positief = doel ligt later
 * dan referentie; negatief = doel ligt eerder.
 */
export function verzendWeekDiff(referentie: Date, doel: Date): number {
  const ma1 = isoMaandag(referentie)
  const ma2 = isoMaandag(doel)
  return Math.round((ma2.getTime() - ma1.getTime()) / (7 * 86_400_000))
}

/**
 * True als de VERZENDweek van de order al vóór de huidige week ligt — de
 * order had dus al verzonden moeten zijn. Losstaand van `pickStatusVoor`
 * (die naar de PICK-week kijkt, 1 week eerder door Karpi's picken-1-week-
 * vooruit-regel): een order met verzendweek == huidige week is nog gewoon
 * op tijd (moet deze week nog verzonden worden), ook al ligt de pick-week
 * daarvan strikt genomen al achter ons. Voor "is dit te laat"-signalering in
 * de UI wil je de verzendweek zelf vergelijken, niet de pick-buffer.
 */
export function verzendWeekAchterstallig(
  afleverdatumIso: string | null,
  vandaag: Date = new Date(),
): boolean {
  if (!afleverdatumIso) return false
  const doel = new Date(afleverdatumIso + 'T00:00:00Z')
  return verzendWeekDiff(lokaleDatumAlsUtc(vandaag), doel) < 0
}

/**
 * Mensvriendelijk relatief label voor de verzendweek t.o.v. vandaag:
 * "deze week" / "volgende week" / "over 3 weken" / "1 week geleden".
 * Retourneert null als afleverdatum ontbreekt — laat de UI zelf bepalen
 * of die "—" wil tonen.
 */
export function verzendWeekRelatief(
  afleverdatumIso: string | null,
  vandaag: Date = new Date()
): string | null {
  if (!afleverdatumIso) return null
  const doel = new Date(afleverdatumIso + 'T00:00:00Z')
  const diff = verzendWeekDiff(lokaleDatumAlsUtc(vandaag), doel)
  if (diff < 0) {
    const n = -diff
    return `${n} ${n === 1 ? 'week' : 'weken'} geleden`
  }
  if (diff === 0) return 'deze week'
  if (diff === 1) return 'volgende week'
  return `over ${diff} weken`
}

/**
 * Pick-week voor een order = ISO-week één week vóór de verzendweek. Karpi's
 * regel: een order met verzendweek N moet in week N-1 gepickt worden.
 * Berekend door 7 dagen af te trekken van de maandag van de verzendweek —
 * dat geeft de juiste jaar/week-combinatie ook rond jaarwisselingen
 * (waar week 52 vs 53 niet-triviaal is).
 */
export function pickWeekVoor(
  afleverdatumIso: string | null
): { jaar: number; week: number } | null {
  if (!afleverdatumIso) return null
  const datum = new Date(afleverdatumIso + 'T00:00:00Z')
  const ma = isoMaandag(datum)
  ma.setUTCDate(ma.getUTCDate() - 7)
  return isoWeek(ma)
}

/**
 * Sectie-label voor de Pick & Ship-overview: legt expliciet uit dat het
 * groepje orders deze week (= pick-week) opgepakt moet worden, mét de
 * bijbehorende verzendweek erbij voor referentie.
 *
 * Voorbeeld: voor verzendweek 20 → "Te picken in week 19 · verzendweek 20".
 */
export function pickWeekLabel(afleverdatumIso: string | null): string {
  const verzend = verzendWeekVoor(afleverdatumIso)
  const pick = pickWeekVoor(afleverdatumIso)
  if (!verzend || !pick) return 'Geen datum'
  return `Te picken in week ${pick.week} · verzendweek ${verzend.week}`
}

/**
 * Pick-status t.o.v. vandaag. Karpi-regel: orders moeten 1 week vóór de
 * verzendweek gepickt zijn, dus pick-week == huidige ISO-week is "on-track".
 *
 * - `'achterstallig'`  pick-week ligt al in het verleden — order had vorige
 *                      week (of eerder) gepickt moeten worden
 * - `'deze_week'`      pick-week == huidige week (on-track)
 * - `'volgende_week'`  pick-week ligt 1 week in de toekomst
 * - `'later'`          pick-week ≥ 2 weken weg
 * - `'geen_datum'`     afleverdatum onbekend
 */
export type PickStatus =
  | 'achterstallig'
  | 'deze_week'
  | 'volgende_week'
  | 'later'
  | 'geen_datum'

export function pickStatusVoor(
  afleverdatumIso: string | null,
  vandaag: Date = new Date()
): PickStatus {
  const pick = pickWeekVoor(afleverdatumIso)
  if (!pick) return 'geen_datum'
  const huidig = isoWeek(lokaleDatumAlsUtc(vandaag))
  const diff = (pick.jaar - huidig.jaar) * 53 + (pick.week - huidig.week)
  if (diff < 0) return 'achterstallig'
  if (diff === 0) return 'deze_week'
  if (diff === 1) return 'volgende_week'
  return 'later'
}
