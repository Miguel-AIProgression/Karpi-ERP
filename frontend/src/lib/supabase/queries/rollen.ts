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

export interface RolToevoegenInput {
  artikelnr: string
  rol_type: RolType
  lengte_cm: number
  breedte_cm: number
  locatie_id: number | null
  in_magazijn_sinds: string | null
  rolnummer: string | null
  reden: string
  medewerker: string | null
}

export interface RolBewerkenInput {
  rol_id: number
  lengte_cm: number
  breedte_cm: number
  locatie_id: number | null
  status: string
  reden: string
  medewerker: string | null
}

export interface RolVerwijderenInput {
  rol_id: number
  reden: string
  medewerker: string | null
}

/** Handmatig een rol/reststuk toevoegen (voorraadcorrectie). RPC mig 291. */
export async function rolToevoegen(
  i: RolToevoegenInput,
): Promise<{ rol_id: number; rolnummer: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('rol_handmatig_toevoegen', {
    p_artikelnr: i.artikelnr,
    p_rol_type: i.rol_type,
    p_lengte_cm: i.lengte_cm,
    p_breedte_cm: i.breedte_cm,
    p_locatie_id: i.locatie_id,
    p_in_magazijn_sinds: i.in_magazijn_sinds,
    p_rolnummer: i.rolnummer,
    p_reden: i.reden,
    p_medewerker: i.medewerker,
  })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  return row as { rol_id: number; rolnummer: string }
}

/** Handmatig een rol bewerken (afmeting/locatie/status). RPC mig 292. */
export async function rolBewerken(i: RolBewerkenInput): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('rol_handmatig_bewerken', {
    p_rol_id: i.rol_id,
    p_lengte_cm: i.lengte_cm,
    p_breedte_cm: i.breedte_cm,
    p_locatie_id: i.locatie_id,
    p_status: i.status,
    p_reden: i.reden,
    p_medewerker: i.medewerker,
  })
  if (error) throw new Error(error.message)
}

/** Handmatig een rol verwijderen (met guard). RPC mig 293. */
export async function rolVerwijderen(i: RolVerwijderenInput): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('rol_verwijderen', {
    p_rol_id: i.rol_id,
    p_reden: i.reden,
    p_medewerker: i.medewerker,
  })
  if (error) throw new Error(error.message)
}
