import { supabase } from '@/lib/supabase/client'
import { sanitizeSearch } from '@/lib/utils/sanitize'
import type { ConfectieRow } from '@/lib/types/productie'

export interface ConfectieStatusCount {
  status: string
  aantal: number
}

export type ConfectieSortField = 'confectie_nr' | 'kwaliteit_code' | 'klant_naam' | 'order_nr' | 'gesneden_datum' | 'status'
export type SortDirection = 'asc' | 'desc'

/** Fetch confectie orders from confectie_overzicht view with filters */
export async function fetchConfectieOrders(params: {
  status?: string
  search?: string
  page?: number
  pageSize?: number
  sortBy?: ConfectieSortField
  sortDir?: SortDirection
}) {
  const {
    status,
    search,
    page = 0,
    pageSize = 50,
    sortBy = 'confectie_nr',
    sortDir = 'desc',
  } = params

  let query = supabase
    .from('confectie_overzicht')
    .select('*', { count: 'exact' })
    .order(sortBy, { ascending: sortDir === 'asc' })
    .range(page * pageSize, (page + 1) * pageSize - 1)

  if (status && status !== 'Alle') {
    query = query.eq('status', status)
  }

  if (search) {
    const s = sanitizeSearch(search)
    if (s) {
      query = query.or(
        `confectie_nr.ilike.%${s}%,order_nr.ilike.%${s}%,klant_naam.ilike.%${s}%,kwaliteit_code.ilike.%${s}%,scancode.ilike.%${s}%`
      )
    }
  }

  const { data, error, count } = await query

  if (error) throw error

  return { confecties: (data ?? []) as ConfectieRow[], totalCount: count ?? 0 }
}

/** Fetch status counts for confectie tabs.
 *  Always uses RPC (one COUNT(*) GROUP BY query in plaats van full table-scan + JS Map). */
export async function fetchConfectieStatusCounts(): Promise<ConfectieStatusCount[]> {
  const { data, error } = await supabase.rpc('confectie_status_counts')
  if (error) throw error
  return ((data ?? []) as { status: string; aantal: number }[]).map((r) => ({
    status: r.status,
    aantal: Number(r.aantal),
  }))
}

/** Fetch single confectie detail */
export async function fetchConfectieDetail(id: number): Promise<ConfectieRow> {
  const { data, error } = await supabase
    .from('confectie_overzicht')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data as ConfectieRow
}

/** Fetch confectie by scancode (barcode/QR lookup) */
export async function fetchConfectieByScancode(scancode: string): Promise<ConfectieRow> {
  const { data, error } = await supabase
    .from('confectie_overzicht')
    .select('*')
    .eq('scancode', scancode)
    .single()

  if (error) throw error
  return data as ConfectieRow
}
