// Tapijt-sticker-data per zending_regel voor standaard (niet-maatwerk)
// artikelen. Bron: view `zending_regel_sticker_data` (mig 303).
//
// Spiegelt qua render-fields `snijplan_sticker_data` zodat dezelfde
// StickerLayout-component hergebruikt kan worden. Per-klant opt-in via
// `debiteuren.tapijt_sticker_bij_standaard` — frontend leest dat van de
// eerste rij (alle rijen van 1 zending horen bij dezelfde debiteur).
import { supabase } from '@/lib/supabase/client'

export interface ZendingRegelStickerData {
  zending_regel_id: number
  zending_id: number
  zending_nr: string
  order_id: number
  order_nr: string
  order_regel_id: number
  debiteur_nr: number
  klant_naam: string
  /** Per-klant voorkeur — copy uit `debiteuren` voor convenience.
   *  Alle rijen van 1 zending hebben dezelfde waarde. */
  tapijt_sticker_bij_standaard: boolean
  kwaliteit_code: string
  kleur_code: string
  lengte_cm: number
  breedte_cm: number
  /** Aantal fysieke stuks op deze zending_regel. Sticker wordt
   *  `aantal × 2` keer geprint (tapijt + orderdossier per stuk). */
  aantal: number
  /** Klanteigen of canonieke kwaliteits-display-naam. */
  kwaliteit_naam: string
  /** Tekst bv. "100% Polypropyleen". NULL = niet getoond op sticker. */
  poolmateriaal: string | null
  /** EAN-13 (13-digit). NULL als geen EAN beschikbaar. */
  ean_code: string | null
  /** ISO-verzendweek 'YYYY-Www'. NULL bij orders zonder afleverdatum. */
  verzendweek_iso: string | null
}

export async function fetchZendingStickerData(
  zendingId: number,
): Promise<ZendingRegelStickerData[]> {
  const { data, error } = await supabase
    .from('zending_regel_sticker_data')
    .select('*')
    .eq('zending_id', zendingId)

  if (error) throw error
  return (data ?? []) as ZendingRegelStickerData[]
}

/** Bulk-variant voor de bulk-print-pagina: 1 query voor N zendingen. */
export async function fetchZendingStickerDataBulk(
  zendingIds: number[],
): Promise<ZendingRegelStickerData[]> {
  if (zendingIds.length === 0) return []
  const { data, error } = await supabase
    .from('zending_regel_sticker_data')
    .select('*')
    .in('zending_id', zendingIds)

  if (error) throw error
  return (data ?? []) as ZendingRegelStickerData[]
}
