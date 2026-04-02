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

export type OrderSortField = 'orderdatum' | 'klant_naam' | 'totaal_bedrag' | 'aantal_regels' | 'order_nr' | 'status'
export type SortDirection = 'asc' | 'desc'

/** Fetch orders with client name, optionally filtered by status or debiteur */
export async function fetchOrders(params: {
  status?: string
  search?: string
  debiteurNr?: number
  page?: number
  pageSize?: number
  sortBy?: OrderSortField
  sortDir?: SortDirection
}) {
  const { status, search, debiteurNr, page = 0, pageSize = 50, sortBy = 'orderdatum', sortDir = 'desc' } = params

  let query = supabase
    .from('orders_list')
    .select('*', { count: 'exact' })
    .order(sortBy, { ascending: sortDir === 'asc' })
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
        `order_nr.ilike.%${s}%,klant_referentie.ilike.%${s}%,klant_naam.ilike.%${s}%`
      )
    }
  }

  const { data, error, count } = await query

  if (error) throw error

  return { orders: (data ?? []) as OrderRow[], totalCount: count ?? 0 }
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
  // Use orders table directly but fetch klant_naam and vertegenw_naam separately
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error

  const order = data as Record<string, unknown>

  // Fetch klant naam
  let klant_naam = '—'
  if (order.debiteur_nr) {
    const { data: deb } = await supabase
      .from('debiteuren')
      .select('naam')
      .eq('debiteur_nr', order.debiteur_nr)
      .single()
    if (deb) klant_naam = deb.naam
  }

  // Fetch vertegenwoordiger naam
  let vertegenw_naam: string | undefined
  if (order.vertegenw_code) {
    const { data: vtw } = await supabase
      .from('vertegenwoordigers')
      .select('naam')
      .eq('code', order.vertegenw_code)
      .single()
    if (vtw) vertegenw_naam = vtw.naam
  }

  return { ...order, klant_naam, vertegenw_naam } as unknown as OrderDetail
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
