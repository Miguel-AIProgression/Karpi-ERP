import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'
import { SHIPPING_PRODUCT_ID } from '@/lib/constants/shipping'

export interface RegelDekking {
  /** Stuks direct uit eigen voorraad. */
  direct: number
  /** Stuks via uitwisselbare producten (omstickeren). */
  uitwisselbaar: number
  /** Stuks die nog op inkoop wachten (echt IO-tekort). */
  ioTekort: number
}

/**
 * Bron-van-waarheid voor het berekenen van bron-splitsing per orderregel.
 * Gebruik in BEIDE inline-tekst (line-editor) en tekort-detectie (order-form)
 * zodat de getallen altijd consistent zijn.
 */
export function berekenRegelDekking(line: OrderRegelFormData): RegelDekking {
  const isVasteMaat = !line.is_maatwerk
    && !!line.artikelnr
    && line.artikelnr !== SHIPPING_PRODUCT_ID
  if (!isVasteMaat) {
    return { direct: 0, uitwisselbaar: 0, ioTekort: 0 }
  }

  const teLeveren = line.te_leveren ?? 0
  const vrij = line.vrije_voorraad ?? 0
  const uitwisselbaarTotaal = (line.uitwisselbaar_keuzes ?? []).reduce(
    (s, k) => s + (k.aantal || 0),
    0,
  )

  const direct = Math.max(0, Math.min(vrij, teLeveren))
  const uitwisselbaar = Math.max(0, Math.min(uitwisselbaarTotaal, teLeveren - direct))
  const ioTekort = Math.max(0, teLeveren - direct - uitwisselbaar)

  return { direct, uitwisselbaar, ioTekort }
}
