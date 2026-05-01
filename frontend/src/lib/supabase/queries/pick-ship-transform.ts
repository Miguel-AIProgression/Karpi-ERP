import { bucketVoor } from '@/lib/utils/pick-ship-buckets'
import { sanitizeSearch } from '@/lib/utils/sanitize'
import type {
  PickShipBron,
  PickShipOrder,
  PickShipRegel,
  VervoerderSelectieStatus,
  PickShipWachtOp,
} from '@/lib/types/pick-ship'

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
}

export interface OrderHeaderRij {
  id: number
  order_nr: string
  status: string
  klant_naam: string | null
  debiteur_nr: number
  vervoerder_code: string | null
  vervoerder_naam: string | null
  vervoerder_actief: boolean | null
  vervoerder_selectie_status: VervoerderSelectieStatus
  afl_naam: string | null
  afl_plaats: string | null
  afleverdatum: string | null
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
      vervoerder_code: h.vervoerder_code,
      vervoerder_naam: h.vervoerder_naam,
      vervoerder_actief: h.vervoerder_actief,
      vervoerder_selectie_status: h.vervoerder_selectie_status,
      afl_naam: h.afl_naam,
      afl_plaats: h.afl_plaats,
      afleverdatum: h.afleverdatum,
      bucket: bucketVoor(h.afleverdatum, vandaag),
      regels: [],
      totaal_m2: 0,
      aantal_regels: 0,
    })
  }

  return perOrder
}

export function mapPickbaarheidRegel(r: PickbaarheidRij): PickShipRegel {
  const lengte = r.maatwerk_lengte_cm ?? 0
  const breedte = r.maatwerk_breedte_cm ?? 0
  const m2 = r.is_maatwerk ? Math.round(((lengte * breedte) / 10000) * 100) / 100 : 0
  const product =
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
