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
  totaal_snijden: number
  totaal_snijden_gepland: number
  totaal_status_gesneden: number
  totaal_in_confectie: number
  totaal_gereed: number
}

/** Fetch grouped summaries, optionally filtered by delivery date.
 *  Always uses RPC function (handles NULL = no filter natively). */
/** Get kleur_code variants: "12" ↔ "12.0" to handle inconsistent DB storage */
function getKleurVariants(kleurCode: string): string[] {
  const variants = [kleurCode]
  if (!kleurCode.includes('.')) variants.push(`${kleurCode}.0`)
  if (kleurCode.endsWith('.0')) variants.push(kleurCode.replace(/\.0$/, ''))
  return variants
}

export async function fetchSnijplanningGroepen(
  search?: string,
  totDatum?: string | null
): Promise<SnijGroepSummary[]> {
  const { data, error } = await supabase.rpc('snijplanning_groepen_gefilterd', {
    p_tot_datum: totDatum ?? null,
  })
  if (error) throw error
  let results = (data ?? []) as SnijGroepSummary[]

  if (search) {
    const s = sanitizeSearch(search)?.toLowerCase()
    if (s) {
      results = results.filter(
        (g) =>
          g.kwaliteit_code.toLowerCase().includes(s) ||
          g.kleur_code.toLowerCase().includes(s)
      )
    }
  }
  return results
}

/** Fetch individual snijplannen for a specific kwaliteit+kleur group */
export async function fetchSnijplannenVoorGroep(
  kwaliteitCode: string,
  kleurCode: string,
  totDatum?: string | null
): Promise<SnijplanRow[]> {
  const kleurVariants = getKleurVariants(kleurCode)
  // Gepland = aan rol toegewezen, niet gestart. Snijden = fysiek onder het mes.
  // Beide tellen als "in de snijplanning" voor het groepoverzicht (migratie 086).
  let query = supabase
    .from('snijplanning_overzicht')
    .select('*')
    .eq('kwaliteit_code', kwaliteitCode)
    .in('kleur_code', kleurVariants)
    .in('status', ['Gepland', 'Snijden'])
    .order('afleverdatum', { ascending: true, nullsFirst: false })

  if (totDatum) {
    // Include items with afleverdatum <= totDatum OR afleverdatum IS NULL
    query = query.or(`afleverdatum.lte.${totDatum},afleverdatum.is.null`)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as SnijplanRow[]
}

/** Fetch locaties voor een set rol-IDs (losse query want view heeft geen locatie-kolom) */
export async function fetchRolLocaties(rolIds: number[]): Promise<Map<number, string | null>> {
  if (rolIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from('rollen')
    .select('id, locatie')
    .in('id', rolIds)
  if (error) throw error
  return new Map((data ?? []).map((r: { id: number; locatie: string | null }) => [r.id, r.locatie]))
}

/** Fetch alle in-pipeline snijplannen (Gepland + Snijden) voor agenda-planning */
export async function fetchAlleSnijden(totDatum?: string | null): Promise<SnijplanRow[]> {
  let query = supabase
    .from('snijplanning_overzicht')
    .select('*')
    .in('status', ['Gepland', 'Snijden'])
    .order('afleverdatum', { ascending: true, nullsFirst: false })

  // Filter op planning-horizon: alléén orders met afleverdatum <= totDatum.
  // Snijplannen zonder afleverdatum blijven meedoen (zeldzaam — backlog/onbekend).
  if (totDatum) {
    query = query.or(`afleverdatum.lte.${totDatum},afleverdatum.is.null`)
  }

  const { data, error } = await query
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

export interface SnijplanningKpis {
  /** Snijplannen met status='Snijden' binnen de planning-horizon (incl. zonder afleverdatum) */
  binnen_horizon: number
  /** Snijplannen met status='Snijden' en afleverdatum in de huidige week (Mon-Sun) */
  deze_week_te_snijden: number
  /** Snijplannen met status='Gesneden' die deze week (Mon-Sun) zijn afgesneden */
  deze_week_gesneden: number
}

/** Bereken Mon-Sun grenzen (ISO) voor de huidige kalenderweek + N weken offset */
function weekRange(offsetWeken = 0): { maandag: string; zondag: string } {
  const nu = new Date()
  const dag = nu.getDay() // 0=zo, 1=ma, ...
  const offsetMa = dag === 0 ? -6 : 1 - dag
  const ma = new Date(nu)
  ma.setDate(nu.getDate() + offsetMa + offsetWeken * 7)
  const zo = new Date(ma)
  zo.setDate(ma.getDate() + 6)
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { maandag: fmt(ma), zondag: fmt(zo) }
}

/** Fetch 3 KPI-cijfers voor de snijplanning-overview header */
export async function fetchSnijplanningKpis(
  totDatum?: string | null,
): Promise<SnijplanningKpis> {
  const dezeWeek = weekRange(0)
  const volgendeWeek = weekRange(1)

  // Gepland + Snijden = beide "in pipeline" (na migratie 086).
  let horizonQuery = supabase
    .from('snijplanning_overzicht')
    .select('*', { count: 'exact', head: true })
    .in('status', ['Gepland', 'Snijden'])
  if (totDatum) {
    horizonQuery = horizonQuery.or(`afleverdatum.lte.${totDatum},afleverdatum.is.null`)
  }

  // "Te snijden deze week" = moet deze week door de snijmachine omdat het
  // volgende week geleverd wordt. Filter dus op afleverdatum in volgende week.
  const dezeWeekTeSnijdenQuery = supabase
    .from('snijplanning_overzicht')
    .select('*', { count: 'exact', head: true })
    .in('status', ['Gepland', 'Snijden'])
    .gte('afleverdatum', volgendeWeek.maandag)
    .lte('afleverdatum', volgendeWeek.zondag)

  const dezeWeekGesnedenQuery = supabase
    .from('snijplanning_overzicht')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'Gesneden')
    .gte('gesneden_op', dezeWeek.maandag)
    .lte('gesneden_op', dezeWeek.zondag + 'T23:59:59')

  const [horizon, dezeWeekTs, dezeWeekGs] = await Promise.all([
    horizonQuery,
    dezeWeekTeSnijdenQuery,
    dezeWeekGesnedenQuery,
  ])

  if (horizon.error) throw horizon.error
  if (dezeWeekTs.error) throw dezeWeekTs.error
  if (dezeWeekGs.error) throw dezeWeekGs.error

  return {
    binnen_horizon: horizon.count ?? 0,
    deze_week_te_snijden: dezeWeekTs.count ?? 0,
    deze_week_gesneden: dezeWeekGs.count ?? 0,
  }
}

export interface TekortAnalyseRow {
  kwaliteit_code: string
  kleur_code: string
  heeft_collectie: boolean
  uitwisselbare_codes: string[]
  aantal_beschikbaar: number
  totaal_beschikbaar_m2: number
  max_lange_zijde_cm: number
  max_korte_zijde_cm: number
  grootste_onpassend_stuk_lange_cm?: number
  grootste_onpassend_stuk_korte_cm?: number
}

export async function fetchTekortAnalyse(): Promise<TekortAnalyseRow[]> {
  const { data, error } = await supabase.rpc('snijplanning_tekort_analyse', {})
  if (error) throw error
  return (data ?? []) as TekortAnalyseRow[]
}

/** Fetch status counts, optionally filtered by delivery date.
 *  Always uses RPC function (single query instead of 8 separate counts). */
export async function fetchSnijplanningStatusCounts(
  totDatum?: string | null
): Promise<SnijplanStatusCount[]> {
  const { data, error } = await supabase.rpc('snijplanning_status_counts_gefilterd', {
    p_tot_datum: totDatum ?? null,
  })
  if (error) throw error
  return (data ?? []).map((r: { status: string; aantal: number }) => ({
    status: r.status,
    aantal: Number(r.aantal),
  }))
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
  const kleurVariants = getKleurVariants(kleurCode)
  const { data, error } = await supabase
    .from('rollen')
    .select('id, rolnummer, lengte_cm, breedte_cm, oppervlak_m2, status, locatie')
    .eq('kwaliteit_code', kwaliteitCode)
    .in('kleur_code', kleurVariants)
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
