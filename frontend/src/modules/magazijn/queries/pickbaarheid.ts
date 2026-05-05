import { supabase } from '@/lib/supabase/client'
import type { BucketKey, PickShipOrder } from '../lib/types'
import {
  chunks,
  comparePickShipOrders,
  filterPickShipOrders,
  initPickShipOrders,
  mapPickbaarheidRegel,
  type OrderHeaderRij,
  type PickbaarheidRij,
} from './pick-ship-transform'

interface FallbackOrderRegelRij {
  id: number
  order_id: number
  regelnummer: number
  artikelnr: string | null
  is_maatwerk: boolean | null
  orderaantal: number | null
  maatwerk_lengte_cm: number | null
  maatwerk_breedte_cm: number | null
  omschrijving: string | null
  maatwerk_kwaliteit_code: string | null
  maatwerk_kleur_code: string | null
}

export interface PickShipParams {
  bucket?: BucketKey
  search?: string
  vandaag?: Date
  /** Default false: toon alle open orders. Zet true voor alleen orders met >=1 pickbare regel. */
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
  const { search, bucket, vandaag = new Date(), alleen_pickbaar = false } = params

  const headers = await fetchOpenOrderHeaders()
  if (headers.length === 0) return []

  const perOrder = initPickShipOrders(headers, vandaag)
  const headerMap = new Map(headers.map((h) => [h.id, h]))
  const regels = await fetchPickbaarheidRegels(headers.map((h) => h.id))

  for (const r of regels) {
    const h = headerMap.get(r.order_id)
    const order = perOrder.get(r.order_id)
    if (!h || !order) continue

    const regel = mapPickbaarheidRegel(r)
    order.regels.push(regel)
    order.totaal_m2 = Math.round((order.totaal_m2 + regel.m2) * 100) / 100
    order.aantal_regels = order.regels.length
  }

  let result = Array.from(perOrder.values())
  if (alleen_pickbaar) {
    result = result.filter((o) => o.regels.some((r) => r.is_pickbaar))
  }
  if (search) result = filterPickShipOrders(result, search)
  if (bucket) result = result.filter((o) => o.bucket === bucket)
  result.sort(comparePickShipOrders)
  return result
}

async function fetchOpenOrderHeaders(): Promise<OrderHeaderRij[]> {
  const { data: ordersRaw, error } = await supabase
    .from('orders')
    .select('id, order_nr, status, debiteur_nr, afl_naam, afl_plaats, afleverdatum')
    .neq('status', 'Verzonden')
    .neq('status', 'Geannuleerd')
    .order('afleverdatum', { ascending: true })
    .order('order_nr', { ascending: true })

  if (error) throw error

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

  return ordersBase.map((o) => ({
    ...o,
    klant_naam: naamMap.get(o.debiteur_nr) ?? null,
  }))
}

async function fetchPickbaarheidRegels(orderIds: number[]): Promise<PickbaarheidRij[]> {
  const { data, error } = await supabase
    .from('orderregel_pickbaarheid')
    .select(
      'order_regel_id, order_id, regelnummer, artikelnr, is_maatwerk, ' +
        'orderaantal, maatwerk_lengte_cm, maatwerk_breedte_cm, omschrijving, ' +
        'maatwerk_kwaliteit_code, maatwerk_kleur_code, totaal_stuks, ' +
        'pickbaar_stuks, is_pickbaar, bron, fysieke_locatie, wacht_op'
    )

  if (!error) return (data ?? []) as unknown as PickbaarheidRij[]
  if (!isMissingPickbaarheidViewError(error)) throw error

  return fetchFallbackOrderRegels(orderIds)
}

async function fetchFallbackOrderRegels(orderIds: number[]): Promise<PickbaarheidRij[]> {
  const rows: FallbackOrderRegelRij[] = []

  for (const ids of chunks(orderIds, 100)) {
    const { data, error } = await supabase
      .from('order_regels')
      .select(
        'id, order_id, regelnummer, artikelnr, is_maatwerk, orderaantal, ' +
          'maatwerk_lengte_cm, maatwerk_breedte_cm, omschrijving, ' +
          'maatwerk_kwaliteit_code, maatwerk_kleur_code'
      )
      .in('order_id', ids)
      .order('regelnummer', { ascending: true })

    if (error) throw error
    rows.push(...((data ?? []) as unknown as FallbackOrderRegelRij[]))
  }

  return rows.map((r) => ({
    order_regel_id: r.id,
    order_id: r.order_id,
    regelnummer: r.regelnummer,
    artikelnr: r.artikelnr,
    is_maatwerk: r.is_maatwerk ?? false,
    orderaantal: r.orderaantal ?? 0,
    maatwerk_lengte_cm: r.maatwerk_lengte_cm,
    maatwerk_breedte_cm: r.maatwerk_breedte_cm,
    omschrijving: r.omschrijving,
    maatwerk_kwaliteit_code: r.maatwerk_kwaliteit_code,
    maatwerk_kleur_code: r.maatwerk_kleur_code,
    totaal_stuks: null,
    pickbaar_stuks: null,
    is_pickbaar: false,
    bron: null,
    fysieke_locatie: null,
    wacht_op: null,
  }))
}

function isMissingPickbaarheidViewError(error: { code?: string; message?: string }): boolean {
  return (
    error.code === 'PGRST205' ||
    (error.message ?? '').includes("Could not find the table 'public.orderregel_pickbaarheid'")
  )
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

// Atomaire vervanger van `createOrGetMagazijnLocatie + UPDATE snijplannen`.
// Zie migratie 0183 + ADR-0002.
export async function setLocatieVoorOrderregel(
  orderRegelId: number,
  locatieCode: string
): Promise<number> {
  const { data, error } = await supabase.rpc('set_locatie_voor_orderregel', {
    p_order_regel_id: orderRegelId,
    p_code: locatieCode,
  })
  if (error) throw error
  return data as number
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
