import { supabase } from '../client'
import { sanitizeSearch } from '@/lib/utils/sanitize'
import { bucketVoor } from '@/lib/utils/pick-ship-buckets'
import type {
  BucketKey,
  PickShipOrder,
  PickShipRegel,
} from '@/lib/types/pick-ship'

interface SnijplanningRij {
  id: number
  snijplan_nr: string
  scancode: string | null
  status: string
  snij_lengte_cm: number | null
  snij_breedte_cm: number | null
  product_omschrijving: string | null
  kleur_code: string | null
  snijplan_locatie: string | null
  order_id: number
  order_nr: string
  debiteur_nr: number
  klant_naam: string
  afleverdatum: string | null
}

interface OrderMetaRij {
  id: number
  afl_naam: string | null
  afl_plaats: string | null
}

export interface PickShipParams {
  /** Optioneel: alleen orders in dit bucket. `undefined` = alle. */
  bucket?: BucketKey
  search?: string
  vandaag?: Date
}

export interface PickShipStats {
  totaal_orders: number
  totaal_stuks: number
  totaal_m2: number
  per_bucket: Record<BucketKey, number>
}

/** Haalt alle ingepakte snijplan-stuks en groepeert ze per order. */
export async function fetchPickShipOrders(
  params: PickShipParams = {}
): Promise<PickShipOrder[]> {
  const { search, bucket, vandaag = new Date() } = params

  let query = supabase
    .from('snijplanning_overzicht')
    .select(
      'id, snijplan_nr, scancode, status, snij_lengte_cm, snij_breedte_cm, ' +
        'product_omschrijving, kleur_code, snijplan_locatie, ' +
        'order_id, order_nr, debiteur_nr, klant_naam, afleverdatum'
    )
    .eq('status', 'Ingepakt')
    .order('afleverdatum', { ascending: true, nullsFirst: false })

  if (search) {
    const s = sanitizeSearch(search)
    if (s) {
      query = query.or(
        `snijplan_nr.ilike.%${s}%,scancode.ilike.%${s}%,order_nr.ilike.%${s}%,klant_naam.ilike.%${s}%`
      )
    }
  }

  const { data, error } = await query
  if (error) throw error

  // Haal afl_naam/afl_plaats apart op (niet in view) -- één extra query op orders.
  const orderIds = Array.from(
    new Set(((data ?? []) as unknown as SnijplanningRij[]).map((r) => r.order_id))
  )
  let orderMeta = new Map<number, { afl_naam: string | null; afl_plaats: string | null }>()
  if (orderIds.length > 0) {
    const { data: ord, error: oerr } = await supabase
      .from('orders')
      .select('id, afl_naam, afl_plaats')
      .in('id', orderIds)
    if (oerr) throw oerr
    orderMeta = new Map(
      ((ord ?? []) as unknown as OrderMetaRij[]).map((o) => [
        o.id,
        { afl_naam: o.afl_naam, afl_plaats: o.afl_plaats },
      ])
    )
  }

  // Groepeer per order
  const perOrder = new Map<number, PickShipOrder>()
  for (const row of (data ?? []) as unknown as SnijplanningRij[]) {
    const orderId = row.order_id
    const lengte = row.snij_lengte_cm ?? 0
    const breedte = row.snij_breedte_cm ?? 0
    const m2 = Math.round(((lengte * breedte) / 10000) * 100) / 100

    const regel: PickShipRegel = {
      snijplan_id: row.id,
      snijplan_nr: row.snijplan_nr,
      scancode: row.scancode ?? null,
      product: row.product_omschrijving ?? '',
      kleur: row.kleur_code ?? null,
      maat_cm: `${lengte} x ${breedte}`,
      m2,
      status: row.status,
      locatie: row.snijplan_locatie ?? null,
    }

    let order = perOrder.get(orderId)
    if (!order) {
      const meta = orderMeta.get(orderId) ?? { afl_naam: null, afl_plaats: null }
      const afleverdatum = row.afleverdatum ?? null
      order = {
        order_id: orderId,
        order_nr: row.order_nr,
        klant_naam: row.klant_naam,
        debiteur_nr: row.debiteur_nr,
        afl_naam: meta.afl_naam,
        afl_plaats: meta.afl_plaats,
        afleverdatum,
        bucket: bucketVoor(afleverdatum, vandaag),
        regels: [],
        totaal_m2: 0,
        aantal_regels: 0,
      }
      perOrder.set(orderId, order)
    }
    order.regels.push(regel)
    order.totaal_m2 = Math.round((order.totaal_m2 + m2) * 100) / 100
    order.aantal_regels = order.regels.length
  }

  let result = Array.from(perOrder.values())
  if (bucket) result = result.filter((o) => o.bucket === bucket)
  return result
}

/** Aggregaten voor stat cards. */
export async function fetchPickShipStats(vandaag: Date = new Date()): Promise<PickShipStats> {
  const orders = await fetchPickShipOrders({ vandaag })
  const stats: PickShipStats = {
    totaal_orders: orders.length,
    totaal_stuks: orders.reduce((s, o) => s + o.aantal_regels, 0),
    totaal_m2: Math.round(orders.reduce((s, o) => s + o.totaal_m2, 0) * 100) / 100,
    per_bucket: {
      achterstallig: 0,
      vandaag: 0,
      morgen: 0,
      deze_week: 0,
      volgende_week: 0,
      later: 0,
      geen_datum: 0,
    },
  }
  for (const o of orders) stats.per_bucket[o.bucket] += 1
  return stats
}

/** Bewerk locatie van een snijplan-stuk. */
export async function updateSnijplanLocatie(
  snijplanId: number,
  locatie: string | null
): Promise<void> {
  const { error } = await supabase
    .from('snijplannen')
    .update({ locatie: locatie === '' ? null : locatie })
    .eq('id', snijplanId)
  if (error) throw error
}
