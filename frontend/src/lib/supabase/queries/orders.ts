import { supabase } from '../client'
import { sanitizeSearch } from '@/lib/utils/sanitize'

export interface OrderRow {
  id: number
  order_nr: string
  oud_order_nr: number | null
  debiteur_nr: number
  klant_referentie: string | null
  orderdatum: string
  afleverdatum: string | null
  status: string
  aantal_regels: number
  totaal_bedrag: number
  totaal_gewicht: number
  vertegenw_code: string | null
  klant_naam?: string
}

export interface OrderDetail extends OrderRow {
  week: string | null
  fact_naam: string | null
  fact_adres: string | null
  fact_postcode: string | null
  fact_plaats: string | null
  fact_land: string | null
  afl_naam: string | null
  afl_naam_2: string | null
  afl_adres: string | null
  afl_postcode: string | null
  afl_plaats: string | null
  afl_land: string | null
  betaler: number | null
  inkooporganisatie: string | null
  compleet_geleverd: boolean
  vertegenw_naam?: string
}

export interface OrderRegel {
  id: number
  regelnummer: number
  artikelnr: string | null
  karpi_code: string | null
  omschrijving: string
  omschrijving_2: string | null
  orderaantal: number
  te_leveren: number
  backorder: number
  prijs: number | null
  korting_pct: number
  bedrag: number | null
  gewicht_kg: number | null
  vrije_voorraad: number | null
}

export interface StatusCount {
  status: string
  aantal: number
}

/** Fetch orders with client name, optionally filtered by status or debiteur */
export async function fetchOrders(params: {
  status?: string
  search?: string
  debiteurNr?: number
  page?: number
  pageSize?: number
}) {
  const { status, search, debiteurNr, page = 0, pageSize = 50 } = params

  let query = supabase
    .from('orders')
    .select(`
      id, order_nr, oud_order_nr, debiteur_nr, klant_referentie,
      orderdatum, afleverdatum, status, aantal_regels, totaal_bedrag,
      totaal_gewicht, vertegenw_code,
      debiteuren!inner(naam)
    `, { count: 'exact' })
    .order('orderdatum', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)

  if (status && status !== 'Alle') {
    query = query.eq('status', status)
  }

  if (debiteurNr) {
    query = query.eq('debiteur_nr', debiteurNr)
  }

  if (search) {
    const s = sanitizeSearch(search)
    if (s) {
      query = query.or(
        `order_nr.ilike.%${s}%,klant_referentie.ilike.%${s}%`
      )
    }
  }

  const { data, error, count } = await query

  if (error) throw error

  const orders: OrderRow[] = (data ?? []).map((row: Record<string, unknown>) => ({
    ...row,
    klant_naam: (row.debiteuren as { naam: string } | null)?.naam ?? '—',
    debiteuren: undefined,
  })) as unknown as OrderRow[]

  return { orders, totalCount: count ?? 0 }
}

/** Fetch status counts for tabs */
export async function fetchStatusCounts(): Promise<StatusCount[]> {
  const { data, error } = await supabase
    .from('orders_status_telling')
    .select('status, aantal')

  if (error) throw error
  return (data ?? []) as StatusCount[]
}

/** Fetch single order with details */
export async function fetchOrderDetail(id: number): Promise<OrderDetail> {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      *,
      debiteuren!inner(naam),
      vertegenwoordigers(naam)
    `)
    .eq('id', id)
    .single()

  if (error) throw error

  const row = data as Record<string, unknown>
  return {
    ...row,
    klant_naam: (row.debiteuren as { naam: string } | null)?.naam ?? '—',
    vertegenw_naam: (row.vertegenwoordigers as { naam: string } | null)?.naam ?? undefined,
  } as unknown as OrderDetail
}

/** Fetch order lines */
export async function fetchOrderRegels(orderId: number): Promise<OrderRegel[]> {
  const { data, error } = await supabase
    .from('order_regels')
    .select('id, regelnummer, artikelnr, karpi_code, omschrijving, omschrijving_2, orderaantal, te_leveren, backorder, prijs, korting_pct, bedrag, gewicht_kg, vrije_voorraad')
    .eq('order_id', orderId)
    .order('regelnummer')

  if (error) throw error
  return (data ?? []) as OrderRegel[]
}
