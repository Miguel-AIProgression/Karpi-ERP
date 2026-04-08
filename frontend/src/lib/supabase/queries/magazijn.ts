import { supabase } from '../client'
import { sanitizeSearch } from '@/lib/utils/sanitize'
import type { MagazijnItem } from '@/lib/types/productie'

export interface MagazijnStats {
  totaal: number
  gesneden: number
  afgewerkt: number
  ingepakt: number
  voorraadwaarde: number
}

export interface MagazijnParams {
  type?: 'op_maat' | 'standaard'
  status?: string
  search?: string
  page?: number
  pageSize?: number
}

/** Fetch magazijn items — snijplannen in post-cutting stages */
export async function fetchMagazijnItems(params: MagazijnParams) {
  const {
    type,
    status,
    search,
    page = 0,
    pageSize = 50,
  } = params

  let query = supabase
    .from('snijplanning_overzicht')
    .select('*', { count: 'exact' })
    .in('status', ['Gesneden', 'In confectie', 'Gereed', 'Ingepakt'])
    .order('gesneden_datum', { ascending: false, nullsFirst: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)

  if (status && status !== 'Alle') {
    query = query.eq('status', status)
  }

  if (search) {
    const s = sanitizeSearch(search)
    if (s) {
      query = query.or(
        `snijplan_nr.ilike.%${s}%,order_nr.ilike.%${s}%,klant_naam.ilike.%${s}%,kwaliteit_code.ilike.%${s}%`
      )
    }
  }

  const { data, error, count } = await query

  if (error) throw error

  // Map to MagazijnItem and optionally filter by type
  let items: MagazijnItem[] = (data ?? []).map((row: Record<string, unknown>) => {
    const isOpMaat = !!(row.maatwerk_vorm || row.maatwerk_afwerking)
    const lengte = Number(row.snij_lengte_cm) || 0
    const breedte = Number(row.snij_breedte_cm) || 0
    const m2 = (lengte * breedte) / 10000

    return {
      type: isOpMaat ? 'op_maat' : 'standaard',
      snijplan_id: row.id as number,
      scancode: (row.scancode as string) ?? null,
      order_nr: row.order_nr as string,
      klant_naam: row.klant_naam as string,
      product: (row.product_omschrijving as string) ?? (row.kwaliteit_code as string) ?? '',
      kleur: (row.kleur_code as string) ?? '',
      maat_cm: `${lengte} x ${breedte}`,
      m2: Math.round(m2 * 100) / 100,
      kostprijs: null,
      status: row.status as string,
      locatie: null,
    } satisfies MagazijnItem
  })

  if (type) {
    items = items.filter((item) => item.type === type)
  }

  return { items, totalCount: count ?? 0 }
}

/** Fetch aggregate stats for magazijn stat cards */
export async function fetchMagazijnStats(): Promise<MagazijnStats> {
  const { data, error } = await supabase
    .from('snijplanning_overzicht')
    .select('status, snij_lengte_cm, snij_breedte_cm')
    .in('status', ['Gesneden', 'In confectie', 'Gereed', 'Ingepakt'])

  if (error) throw error

  const rows = data ?? []
  const stats: MagazijnStats = {
    totaal: rows.length,
    gesneden: 0,
    afgewerkt: 0,
    ingepakt: 0,
    voorraadwaarde: 0,
  }

  for (const row of rows) {
    const s = row.status as string
    if (s === 'Gesneden') stats.gesneden++
    else if (s === 'In confectie' || s === 'Gereed') stats.afgewerkt++
    else if (s === 'Ingepakt') stats.ingepakt++
  }

  return stats
}
