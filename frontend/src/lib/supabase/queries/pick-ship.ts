import { supabase } from '../client'
import { sanitizeSearch } from '@/lib/utils/sanitize'
import { bucketVoor } from '@/lib/utils/pick-ship-buckets'
import type {
  BucketKey,
  PickShipBron,
  PickShipOrder,
  PickShipRegel,
  PickShipWachtOp,
} from '@/lib/types/pick-ship'

interface PickbaarheidRij {
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

interface OrderHeaderRij {
  id: number
  order_nr: string
  klant_naam: string | null
  debiteur_nr: number
  afl_naam: string | null
  afl_plaats: string | null
  afleverdatum: string | null
}

export interface PickShipParams {
  bucket?: BucketKey
  search?: string
  vandaag?: Date
  /** Default true: alleen orders met >=1 pickbare regel. */
  alleen_pickbaar?: boolean
}

export interface PickShipStats {
  totaal_orders: number
  totaal_stuks: number
  totaal_m2: number
  per_bucket: Record<BucketKey, number>
}

export async function fetchPickShipOrders(
  params: PickShipParams = {}
): Promise<PickShipOrder[]> {
  const { search, bucket, vandaag = new Date(), alleen_pickbaar = true } = params

  const { data: regelsRaw, error } = await supabase
    .from('orderregel_pickbaarheid')
    .select(
      'order_regel_id, order_id, regelnummer, artikelnr, is_maatwerk, ' +
        'orderaantal, maatwerk_lengte_cm, maatwerk_breedte_cm, omschrijving, ' +
        'maatwerk_kwaliteit_code, maatwerk_kleur_code, totaal_stuks, ' +
        'pickbaar_stuks, is_pickbaar, bron, fysieke_locatie, wacht_op'
    )
  if (error) throw error
  const regels = (regelsRaw ?? []) as unknown as PickbaarheidRij[]
  if (regels.length === 0) return []

  const orderIds = Array.from(new Set(regels.map((r) => r.order_id)))
  const { data: ordersRaw, error: oerr } = await supabase
    .from('orders')
    .select('id, order_nr, debiteur_nr, afl_naam, afl_plaats, afleverdatum')
    .in('id', orderIds)
  if (oerr) throw oerr
  const ordersBase = (ordersRaw ?? []) as unknown as Array<Omit<OrderHeaderRij, 'klant_naam'>>

  const debiteurNrs = Array.from(new Set(ordersBase.map((o) => o.debiteur_nr)))
  const naamMap = new Map<number, string>()
  if (debiteurNrs.length > 0) {
    const { data: debs, error: derr } = await supabase
      .from('debiteuren')
      .select('debiteur_nr, naam')
      .in('debiteur_nr', debiteurNrs)
    if (derr) throw derr
    for (const d of (debs ?? []) as Array<{ debiteur_nr: number; naam: string }>) {
      naamMap.set(d.debiteur_nr, d.naam)
    }
  }

  const headers: OrderHeaderRij[] = ordersBase.map((o) => ({
    ...o,
    klant_naam: naamMap.get(o.debiteur_nr) ?? null,
  }))
  const headerMap = new Map(headers.map((h) => [h.id, h]))

  let work = regels
  if (search) {
    const s = sanitizeSearch(search).toLowerCase()
    if (s) {
      work = regels.filter((r) => {
        const h = headerMap.get(r.order_id)
        return (
          (h?.order_nr ?? '').toLowerCase().includes(s) ||
          (h?.klant_naam ?? '').toLowerCase().includes(s) ||
          (r.omschrijving ?? '').toLowerCase().includes(s) ||
          (r.artikelnr ?? '').toLowerCase().includes(s)
        )
      })
    }
  }

  const perOrder = new Map<number, PickShipOrder>()
  for (const r of work) {
    const h = headerMap.get(r.order_id)
    if (!h) continue

    const lengte = r.maatwerk_lengte_cm ?? 0
    const breedte = r.maatwerk_breedte_cm ?? 0
    const m2 = r.is_maatwerk ? Math.round(((lengte * breedte) / 10000) * 100) / 100 : 0

    const regel: PickShipRegel = {
      order_regel_id: r.order_regel_id,
      artikelnr: r.artikelnr,
      is_maatwerk: r.is_maatwerk,
      product:
        r.omschrijving ??
        [r.maatwerk_kwaliteit_code, r.maatwerk_kleur_code].filter(Boolean).join(' '),
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

    let order = perOrder.get(r.order_id)
    if (!order) {
      order = {
        order_id: h.id,
        order_nr: h.order_nr,
        klant_naam: h.klant_naam ?? '',
        debiteur_nr: h.debiteur_nr,
        afl_naam: h.afl_naam,
        afl_plaats: h.afl_plaats,
        afleverdatum: h.afleverdatum,
        bucket: bucketVoor(h.afleverdatum, vandaag),
        regels: [],
        totaal_m2: 0,
        aantal_regels: 0,
      }
      perOrder.set(r.order_id, order)
    }
    order.regels.push(regel)
    order.totaal_m2 = Math.round((order.totaal_m2 + m2) * 100) / 100
    order.aantal_regels = order.regels.length
  }

  let result = Array.from(perOrder.values())
  if (alleen_pickbaar) {
    result = result.filter((o) => o.regels.some((r) => r.is_pickbaar))
  }
  if (bucket) result = result.filter((o) => o.bucket === bucket)
  return result
}

export async function fetchPickShipStats(vandaag: Date = new Date()): Promise<PickShipStats> {
  const orders = await fetchPickShipOrders({ vandaag })
  const stats: PickShipStats = {
    totaal_orders: orders.length,
    totaal_stuks: orders.reduce((s, o) => s + o.aantal_regels, 0),
    totaal_m2: Math.round(orders.reduce((s, o) => s + o.totaal_m2, 0) * 100) / 100,
    per_bucket: {
      achterstallig: 0, vandaag: 0, morgen: 0, deze_week: 0,
      volgende_week: 0, later: 0, geen_datum: 0,
    },
  }
  for (const o of orders) stats.per_bucket[o.bucket] += 1
  return stats
}

export async function updateMaatwerkLocatie(
  orderRegelId: number,
  locatieCode: string
): Promise<void> {
  const { error } = await supabase
    .from('snijplannen')
    .update({ locatie: locatieCode })
    .eq('order_regel_id', orderRegelId)
    .eq('status', 'Ingepakt')
  if (error) throw error
}

export async function updateRolLocatieVoorArtikel(
  artikelnr: string,
  magazijnLocatieId: number
): Promise<void> {
  const { data, error: selErr } = await supabase
    .from('rollen')
    .select('id')
    .eq('artikelnr', artikelnr)
    .eq('status', 'beschikbaar')
    .order('id', { ascending: true })
    .limit(1)
  if (selErr) throw selErr
  const rolId = (data?.[0] as { id: number } | undefined)?.id
  if (!rolId) throw new Error(`Geen beschikbare rol voor artikel ${artikelnr}`)
  const { error } = await supabase
    .from('rollen')
    .update({ locatie_id: magazijnLocatieId })
    .eq('id', rolId)
  if (error) throw error
}
