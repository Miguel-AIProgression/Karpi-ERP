import { supabase } from '../client'
import { sanitizeSearch } from '@/lib/utils/sanitize'
import type { RolRow, RolGroep, RolType } from '@/lib/types/productie'

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

interface UitwisselRow {
  kwaliteit_code: string
  kleur_code: string
  equiv_kwaliteit_code: string
  equiv_kleur_code: string
  equiv_rollen: number
  equiv_m2: number
}

/** Fetch rollen grouped by kwaliteit_code + kleur_code, met equiv-info
 *  op groepen zonder eigen voorraad (via rollen_uitwissel_voorraad RPC). */
export async function fetchRollenGegroepeerd(
  search?: string,
  kwaliteitFilter?: string,
  kleurFilter?: string,
): Promise<RolGroep[]> {
  const buildQuery = () => {
    let q = supabase
      .from('rollen')
      .select('*')
      .not('status', 'in', '("verkocht","gesneden")')
      .order('kwaliteit_code', { ascending: true })
      .order('kleur_code', { ascending: true })

    if (kwaliteitFilter) {
      q = q.eq('kwaliteit_code', kwaliteitFilter)
    }
    if (kleurFilter) {
      q = q.eq('kleur_code', kleurFilter.replace(/\.0+$/, ''))
    }
    if (search && !kwaliteitFilter) {
      const s = sanitizeSearch(search)
      if (s) {
        q = q.or(
          `rolnummer.ilike.%${s}%,kwaliteit_code.ilike.%${s}%,kleur_code.ilike.%${s}%,omschrijving.ilike.%${s}%`,
        )
      }
    }
    return q
  }

  const PAGE_SIZE = 1000
  const rows: RolRow[] = []
  let offset = 0
  while (true) {
    const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...(data as RolRow[]))
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

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
        equiv_kwaliteit_code: null,
        equiv_kleur_code: null,
        equiv_rollen: 0,
        equiv_m2: 0,
      }
      groupMap.set(key, group)
    }
    group.rollen.push(rol)
    group.totaal_rollen++
    group.totaal_m2 += Number(rol.oppervlak_m2) || 0
    if (rol.rol_type === 'volle_rol') group.volle_rollen++
    else if (rol.rol_type === 'aangebroken') group.aangebroken++
    else if (rol.rol_type === 'reststuk') group.reststukken++
  }

  // Uitwissel-info ophalen en mergen op groepen met totaal_m2 = 0
  const { data: uitwisselData, error: uitwisselError } = await (supabase.rpc as any)(
    'rollen_uitwissel_voorraad',
  )
  if (uitwisselError) throw uitwisselError

  const normKleur = (k: string) => k.replace(/\.0+$/, '')
  const uitwisselMap = new Map<string, UitwisselRow>()
  for (const row of (uitwisselData ?? []) as UitwisselRow[]) {
    const key = `${row.kwaliteit_code}|${normKleur(row.kleur_code)}`
    uitwisselMap.set(key, row)
  }

  for (const g of groupMap.values()) {
    if (g.totaal_m2 > 0) continue // alleen lege groepen krijgen equiv-info
    const key = `${g.kwaliteit_code}|${normKleur(g.kleur_code)}`
    const eq = uitwisselMap.get(key)
    if (!eq) continue
    g.equiv_kwaliteit_code = eq.equiv_kwaliteit_code
    g.equiv_kleur_code = normKleur(eq.equiv_kleur_code)
    g.equiv_rollen = Number(eq.equiv_rollen) || 0
    g.equiv_m2 = Number(eq.equiv_m2) || 0
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
