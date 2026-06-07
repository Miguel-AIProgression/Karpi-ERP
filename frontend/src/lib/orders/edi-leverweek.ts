// EDI-leverweek-seam: bepaalt of een EDI-order zijn (klant-gewenste) leverweek
// nog moet laten bevestigen, en vergelijkt de gewenste week met de haalbare
// week (= door allocator/mig 153 bijgewerkte orders.afleverdatum).
//
// Gate-conventie (mig 158 + 309): een EDI-order is "te bevestigen" zolang
// edi_bevestigd_op NULL is. Niet-EDI-orders kennen dit concept niet.

import { verzendWeekDiff } from './verzendweek'

export interface LeverweekOrderVelden {
  bron_systeem?: string | null
  edi_bevestigd_op?: string | null
}

/** True als dit een EDI-order is waarvan de leverweek nog bevestigd moet worden. */
export function isLeverweekTeBevestigen(order: LeverweekOrderVelden): boolean {
  return order.bron_systeem === 'edi' && !order.edi_bevestigd_op
}

export type LeverweekRelatie = 'gelijk' | 'later' | 'eerder' | 'onbekend'

export interface LeverweekVergelijking {
  relatie: LeverweekRelatie
  /** Absoluut aantal ISO-weken tussen gewenst en haalbaar (0 bij 'gelijk'). */
  weken: number
}

/**
 * Vergelijkt de gewenste leverdatum (EDI-wens) met de haalbare leverdatum
 * (huidige orders.afleverdatum). Vergelijking op ISO-weekniveau — de exacte
 * dag binnen de week is voor B2B-levering niet leidend (zie verzendweek.ts).
 *
 * Delegeert de week-aritmetiek aan `verzendWeekDiff` (maandag-van-de-week-
 * aftrekking) zodat het aantal weken ook rond jaarwisselingen klopt — een
 * `(jaar*53 + week)`-benadering kan daar 1 week mis tellen.
 */
export function vergelijkLeverweek(
  gewenstIso: string | null,
  haalbaarIso: string | null,
): LeverweekVergelijking {
  if (!gewenstIso || !haalbaarIso) return { relatie: 'onbekend', weken: 0 }
  const diff = verzendWeekDiff(
    new Date(gewenstIso + 'T00:00:00Z'),
    new Date(haalbaarIso + 'T00:00:00Z'),
  )
  if (diff === 0) return { relatie: 'gelijk', weken: 0 }
  if (diff > 0) return { relatie: 'later', weken: diff }
  return { relatie: 'eerder', weken: -diff }
}
