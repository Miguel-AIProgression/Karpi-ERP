import { supabase } from '../client'
import { sanitizeSearch } from '@/lib/utils/sanitize'
import type { RolRow, RolGroep } from '@/lib/types/productie'

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

/** Fetch rollen grouped by kwaliteit_code + kleur_code */
export async function fetchRollenGegroepeerd(search?: string, kwaliteitFilter?: string, kleurFilter?: string): Promise<RolGroep[]> {
  let query = supabase
    .from('rollen')
    .select('*')
    .not('status', 'in', '("verkocht","gesneden")')
    .order('kwaliteit_code', { ascending: true })
    .order('kleur_code', { ascending: true })

  // Exact filters (from URL params)
  if (kwaliteitFilter) {
    query = query.eq('kwaliteit_code', kwaliteitFilter)
  }
  if (kleurFilter) {
    // Include .0 variant
    const variants = [kleurFilter]
    if (!kleurFilter.includes('.')) variants.push(`${kleurFilter}.0`)
    if (kleurFilter.endsWith('.0')) variants.push(kleurFilter.replace('.0', ''))
    query = query.in('kleur_code', variants)
  }

  if (search && !kwaliteitFilter) {
    const s = sanitizeSearch(search)
    if (s) {
      query = query.or(
        `rolnummer.ilike.%${s}%,kwaliteit_code.ilike.%${s}%,kleur_code.ilike.%${s}%,omschrijving.ilike.%${s}%`
      )
    }
  }

  // Supabase default limit = 1000; expliciet hoger zetten
  const { data, error } = await query.limit(10000)

  if (error) throw error

  const rows = (data ?? []) as RolRow[]
  const groupMap = new Map<string, RolGroep>()

  for (const rol of rows) {
    const key = `${rol.kwaliteit_code}|${rol.kleur_code}`
    let group = groupMap.get(key)
    if (!group) {
      group = {
        kwaliteit_code: rol.kwaliteit_code,
        kleur_code: rol.kleur_code,
        product_naam: `${rol.kwaliteit_code} ${rol.kleur_code}`,
        rollen: [],
        totaal_rollen: 0,
        totaal_m2: 0,
        volle_rollen: 0,
        aangebroken: 0,
        reststukken: 0,
      }
      groupMap.set(key, group)
    }
    group.rollen.push(rol)
    group.totaal_rollen++
    group.totaal_m2 += Number(rol.oppervlak_m2) || 0

    if (rol.status === 'beschikbaar' || rol.status === 'gereserveerd') {
      group.volle_rollen++
    } else if (rol.status === 'in_snijplan') {
      group.aangebroken++
    } else if (rol.status === 'reststuk') {
      group.reststukken++
    }
  }

  return Array.from(groupMap.values())
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
