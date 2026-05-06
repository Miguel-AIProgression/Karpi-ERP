import { supabase } from '../client'
import { sanitizeSearch } from '@/lib/utils/sanitize'
import type { RolRow, RolType } from '@/lib/types/productie'

export interface RollenStats {
  totaal: number
  totaal_m2: number
  volle_rollen: number
  volle_m2: number
  aangebroken: number
  aangebroken_m2: number
  reststukken: number
  reststukken_m2: number
  leeg_op: number
}

export interface RollenParams {
  status?: string
  rol_type?: RolType
  kwaliteit_code?: string
  kleur_code?: string
  search?: string
  page?: number
  pageSize?: number
}

/** Fetch rollen with filters and pagination */
export async function fetchRollen(params: RollenParams) {
  const {
    status,
    rol_type,
    kwaliteit_code,
    kleur_code,
    search,
    page = 0,
    pageSize = 50,
  } = params

  let query = supabase
    .from('rollen')
    .select('*', { count: 'exact' })
    .order('kwaliteit_code', { ascending: true })
    .order('kleur_code', { ascending: true })
    .range(page * pageSize, (page + 1) * pageSize - 1)

  if (status && status !== 'Alle') {
    query = query.eq('status', status)
  }

  if (rol_type) {
    query = query.eq('rol_type', rol_type)
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
        `rolnummer.ilike.%${s}%,kwaliteit_code.ilike.%${s}%,kleur_code.ilike.%${s}%,omschrijving.ilike.%${s}%`
      )
    }
  }

  const { data, error, count } = await query

  if (error) throw error

  return { rollen: (data ?? []) as RolRow[], totalCount: count ?? 0 }
}

/** Fetch aggregate stats for stat cards (server-side aggregation) */
export async function fetchRollenStats(): Promise<RollenStats> {
  const { data, error } = await supabase.rpc('rollen_stats')

  if (error) throw error

  const d = data as Record<string, number>
  return {
    totaal: d.totaal ?? 0,
    totaal_m2: Number(d.totaal_m2) || 0,
    volle_rollen: d.volle_rollen ?? 0,
    volle_m2: Number(d.volle_m2) || 0,
    aangebroken: d.aangebroken ?? 0,
    aangebroken_m2: Number(d.aangebroken_m2) || 0,
    reststukken: d.reststukken ?? 0,
    reststukken_m2: Number(d.reststukken_m2) || 0,
    leeg_op: d.leeg_op ?? 0,
  }
}

/** Fetch single roll detail */
export async function fetchRolDetail(id: number): Promise<RolRow> {
  const { data, error } = await supabase
    .from('rollen')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data as RolRow
}
