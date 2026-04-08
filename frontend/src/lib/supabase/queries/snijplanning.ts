import { supabase } from '../client'
import { sanitizeSearch } from '@/lib/utils/sanitize'
import type { SnijplanRow, ProductieDashboard } from '@/lib/types/productie'

export interface SnijplanStatusCount {
  status: string
  aantal: number
}

export type SnijplanSortField = 'prioriteit' | 'afleverdatum' | 'klant_naam' | 'order_nr' | 'snijplan_nr' | 'status'
export type SortDirection = 'asc' | 'desc'

/** Grouped summary per kwaliteit+kleur (from snijplanning_groepen view) */
export interface SnijGroepSummary {
  kwaliteit_code: string
  kleur_code: string
  totaal_stukken: number
  totaal_orders: number
  totaal_m2: number
  totaal_gesneden: number
  vroegste_afleverdatum: string | null
}

/** Fetch grouped summaries (313 rows instead of 2167) */
export async function fetchSnijplanningGroepen(search?: string): Promise<SnijGroepSummary[]> {
  let query = supabase
    .from('snijplanning_groepen')
    .select('*')
    .order('kwaliteit_code', { ascending: true })

  if (search) {
    const s = sanitizeSearch(search)
    if (s) {
      query = query.or(`kwaliteit_code.ilike.%${s}%,kleur_code.ilike.%${s}%`)
    }
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as SnijGroepSummary[]
}

/** Fetch individual snijplannen for a specific kwaliteit+kleur group */
export async function fetchSnijplannenVoorGroep(
  kwaliteitCode: string,
  kleurCode: string
): Promise<SnijplanRow[]> {
  const { data, error } = await supabase
    .from('snijplanning_overzicht')
    .select('*')
    .eq('kwaliteit_code', kwaliteitCode)
    .eq('kleur_code', kleurCode)
    .order('afleverdatum', { ascending: true, nullsFirst: false })

  if (error) throw error
  return (data ?? []) as SnijplanRow[]
}

/** Fetch snijplannen pool from snijplanning_overzicht view with filters */
export async function fetchSnijplanningPool(params: {
  status?: string
  planning_week?: number
  planning_jaar?: number
  kwaliteit_code?: string
  kleur_code?: string
  search?: string
  page?: number
  pageSize?: number
  sortBy?: SnijplanSortField
  sortDir?: SortDirection
}) {
  const {
    status,
    kwaliteit_code,
    kleur_code,
    search,
    page = 0,
    pageSize = 50,
    sortBy = 'prioriteit',
    sortDir = 'asc',
  } = params

  let query = supabase
    .from('snijplanning_overzicht')
    .select('*', { count: 'exact' })
    .order(sortBy, { ascending: sortDir === 'asc' })
    .range(page * pageSize, (page + 1) * pageSize - 1)

  if (status && status !== 'Alle') {
    query = query.eq('status', status)
  }

  if (kwaliteit_code) {
    query = query.eq('kwaliteit_code', kwaliteit_code)
  }

  if (kleur_code) {
    query = query.eq('kleur_code', kleur_code)
  }

  if (search) {
    const s = sanitizeSearch(search)
    if (s) {
      query = query.or(
        `snijplan_nr.ilike.%${s}%,order_nr.ilike.%${s}%,klant_naam.ilike.%${s}%,rolnummer.ilike.%${s}%`
      )
    }
  }

  const { data, error, count } = await query

  if (error) throw error

  return { snijplannen: (data ?? []) as SnijplanRow[], totalCount: count ?? 0 }
}

/** Fetch status counts for snijplan tabs */
export async function fetchSnijplanningStatusCounts(): Promise<SnijplanStatusCount[]> {
  const statuses = ['Wacht', 'Gepland', 'In productie', 'Gesneden', 'In confectie', 'Gereed', 'Ingepakt', 'Geannuleerd']

  const results: SnijplanStatusCount[] = []
  for (const s of statuses) {
    const { count, error } = await supabase
      .from('snijplanning_overzicht')
      .select('*', { count: 'exact', head: true })
      .eq('status', s)

    if (error) throw error
    if (count && count > 0) {
      results.push({ status: s, aantal: count })
    }
  }

  return results
}

/** Fetch single snijplan detail */
export async function fetchSnijplanDetail(id: number): Promise<SnijplanRow> {
  const { data, error } = await supabase
    .from('snijplanning_overzicht')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data as SnijplanRow
}

/** Fetch all snijplannen for a specific roll (for the roll cutting proposal view) */
export async function fetchRolSnijstukken(rolId: number): Promise<SnijplanRow[]> {
  const { data, error } = await supabase
    .from('snijplanning_overzicht')
    .select('*')
    .eq('rol_id', rolId)
    .order('positie_x_cm', { ascending: true })

  if (error) throw error
  return (data ?? []) as SnijplanRow[]
}

/** Fetch available rolls for a quality+color combo, ordered by priority */
export async function fetchBeschikbareRollen(kwaliteitCode: string, kleurCode: string) {
  const { data, error } = await supabase
    .from('rollen')
    .select('id, rolnummer, lengte_cm, breedte_cm, oppervlak_m2, status, locatie')
    .eq('kwaliteit_code', kwaliteitCode)
    .eq('kleur_code', kleurCode)
    .in('status', ['reststuk', 'beschikbaar'])
    .order('status', { ascending: true })  // reststuk before beschikbaar
    .order('lengte_cm', { ascending: true })

  if (error) throw error
  return (data ?? []) as {
    id: number
    rolnummer: string
    lengte_cm: number
    breedte_cm: number
    oppervlak_m2: number
    status: string
    locatie: string | null
  }[]
}

/** Fetch productie dashboard stats */
export async function fetchProductieDashboard(): Promise<ProductieDashboard> {
  const { data, error } = await supabase
    .from('productie_dashboard')
    .select('*')
    .single()

  if (error) throw error
  return data as ProductieDashboard
}
