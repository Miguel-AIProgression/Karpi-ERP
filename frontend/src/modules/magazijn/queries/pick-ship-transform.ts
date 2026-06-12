import { bucketVoor } from '../lib/buckets'
import {
  verzendWeekKort,
  verzendWeekLabel,
  verzendWeekSleutel,
} from '@/lib/orders/verzendweek'
import { sanitizeSearch } from '@/lib/utils/sanitize'
import type {
  PickShipBron,
  PickShipOrder,
  PickShipRegel,
  PickShipWachtOp,
} from '../lib/types'

/** Rij uit view `order_pickbaarheid` (mig 385): het order-niveau-predicaat.
 *  Geen rij voor een order = geen (niet-pseudo) regels = niets te picken. */
export interface OrderPickbaarheidRij {
  order_id: number
  totaal_regels: number
  pickbare_regels: number
  alle_regels_pickbaar: boolean
  heeft_pickbare_regel: boolean
  deelleveringen_toegestaan: boolean
  pick_ship_zichtbaar: boolean
}

export interface PickbaarheidRij {
  order_regel_id: number
  order_id: number
  regelnummer: number
  artikelnr: string | null
  is_maatwerk: boolean
  orderaantal: number
  maatwerk_lengte_cm: number | null
  maatwerk_breedte_cm: number | null
  omschrijving: string | null
  maatwerk_kwaliteit_code: string | null
  maatwerk_kleur_code: string | null
  totaal_stuks: number | null
  pickbaar_stuks: number | null
  is_pickbaar: boolean
  bron: PickShipBron
  fysieke_locatie: string | null
  wacht_op: PickShipWachtOp
  /** Mig 385: gewicht per stuk uit order_regels, via de view — vervangt de
   *  aparte gewicht-query. */
  gewicht_kg: number | null
}

export interface OrderHeaderRij {
  id: number
  order_nr: string
  status: string
  klant_naam: string | null
  debiteur_nr: number
  afl_naam: string | null
  afl_adres: string | null
  afl_postcode: string | null
  afl_plaats: string | null
  afl_land: string | null
  afleverdatum: string | null
  afhalen: boolean
  /** ADR 0014 / mig 244: 'datum' = pick-horizon = 1 werkdag vóór afleverdatum;
   *  'week' = direct zichtbaar zodra pickbaar. */
  lever_type: 'week' | 'datum'
}

export function initPickShipOrders(
  headers: OrderHeaderRij[],
  vandaag: Date
): Map<number, PickShipOrder> {
  const perOrder = new Map<number, PickShipOrder>()

  for (const h of headers) {
    perOrder.set(h.id, {
      order_id: h.id,
      order_nr: h.order_nr,
      status: h.status,
      klant_naam: h.klant_naam ?? '',
      debiteur_nr: h.debiteur_nr,
      afl_naam: h.afl_naam,
      afl_adres: h.afl_adres,
      afl_postcode: h.afl_postcode,
      afl_plaats: h.afl_plaats,
      afl_land: h.afl_land,
      afleverdatum: h.afleverdatum,
      afhalen: h.afhalen,
      lever_type: h.lever_type,
      bucket: bucketVoor(h.afleverdatum, vandaag),
      verzend_week_sleutel: verzendWeekSleutel(h.afleverdatum),
      verzend_week_label: verzendWeekLabel(h.afleverdatum),
      verzend_week_kort: verzendWeekKort(h.afleverdatum),
      regels: [],
      totaal_m2: 0,
      totaal_gewicht_kg: 0,
      aantal_regels: 0,
      alle_regels_pickbaar: false,
      actieve_pickronde: null,
    })
  }

  return perOrder
}

export function mapPickbaarheidRegel(
  r: PickbaarheidRij,
  karpiNaam: string | null = null,
): PickShipRegel {
  const lengte = r.maatwerk_lengte_cm ?? 0
  const breedte = r.maatwerk_breedte_cm ?? 0
  const m2 = r.is_maatwerk ? Math.round(((lengte * breedte) / 10000) * 100) / 100 : 0
  // Pick & Ship toont de canonische Karpi-naam (producten.omschrijving) — geen
  // klanteigen-naam. Het magazijn werkt op Karpi's eigen artikel-administratie;
  // klantnamen horen pas op pakbon/verzendsticker thuis.
  const product =
    karpiNaam ||
    r.omschrijving ||
    [r.maatwerk_kwaliteit_code, r.maatwerk_kleur_code].filter(Boolean).join(' ') ||
    `Regel ${r.regelnummer}`

  return {
    order_regel_id: r.order_regel_id,
    artikelnr: r.artikelnr,
    is_maatwerk: r.is_maatwerk,
    product,
    kleur: r.maatwerk_kleur_code,
    maat_cm: r.is_maatwerk ? `${lengte} x ${breedte}` : `${r.orderaantal} stuk(s)`,
    m2,
    orderaantal: r.orderaantal,
    is_pickbaar: r.is_pickbaar,
    bron: r.bron,
    fysieke_locatie: r.fysieke_locatie,
    wacht_op: r.wacht_op,
    totaal_stuks: r.totaal_stuks,
    pickbaar_stuks: r.pickbaar_stuks,
  }
}

export function filterPickShipOrders(orders: PickShipOrder[], search: string): PickShipOrder[] {
  const s = sanitizeSearch(search).toLowerCase()
  if (!s) return orders

  return orders.filter((o) => {
    const headerMatches =
      o.order_nr.toLowerCase().includes(s) ||
      o.klant_naam.toLowerCase().includes(s) ||
      o.status.toLowerCase().includes(s) ||
      String(o.debiteur_nr).includes(s) ||
      (o.afl_naam ?? '').toLowerCase().includes(s) ||
      (o.afl_plaats ?? '').toLowerCase().includes(s)

    return (
      headerMatches ||
      o.regels.some(
        (r) =>
          r.product.toLowerCase().includes(s) ||
          (r.artikelnr ?? '').toLowerCase().includes(s) ||
          (r.fysieke_locatie ?? '').toLowerCase().includes(s)
      )
    )
  })
}

export function comparePickShipOrders(a: PickShipOrder, b: PickShipOrder): number {
  const ad = a.afleverdatum ?? '9999-12-31'
  const bd = b.afleverdatum ?? '9999-12-31'
  return ad.localeCompare(bd) || a.order_nr.localeCompare(b.order_nr)
}

export function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size))
  }
  return result
}
