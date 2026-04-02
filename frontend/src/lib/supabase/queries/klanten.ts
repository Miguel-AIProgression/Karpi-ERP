import { supabase } from '../client'
import { sanitizeSearch } from '@/lib/utils/sanitize'

export interface KlantRow {
  debiteur_nr: number
  naam: string
  status: string
  tier: string
  logo_path: string | null
  telefoon: string | null
  email_factuur: string | null
  vertegenw_code: string | null
  vertegenwoordiger_naam: string | null
  omzet_ytd: number
  aantal_orders_ytd: number
  pct_van_totaal: number
  plaats: string | null
}

export interface KlantDetail {
  debiteur_nr: number
  naam: string
  status: string
  tier: string
  logo_path: string | null
  adres: string | null
  postcode: string | null
  plaats: string | null
  land: string | null
  telefoon: string | null
  fact_naam: string | null
  fact_adres: string | null
  fact_postcode: string | null
  fact_plaats: string | null
  email_factuur: string | null
  email_overig: string | null
  email_2: string | null
  fax: string | null
  vertegenw_code: string | null
  route: string | null
  rayon_naam: string | null
  prijslijst_nr: string | null
  korting_pct: number
  betaalconditie: string | null
  btw_nummer: string | null
  gln_bedrijf: string | null
  omzet_ytd: number
}

export interface Afleveradres {
  id: number
  adres_nr: number
  naam: string | null
  adres: string | null
  postcode: string | null
  plaats: string | null
  land: string | null
  telefoon: string | null
  email: string | null
  gln_afleveradres: string | null
}

/** Fetch klanten with YTD omzet (via view) */
export async function fetchKlanten(params: {
  search?: string
  status?: string
  tier?: string
  page?: number
  pageSize?: number
}) {
  const { search, status, tier, page = 0, pageSize = 50 } = params

  let query = supabase
    .from('klant_omzet_ytd')
    .select('*', { count: 'exact' })
    .order('omzet_ytd', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)

  if (status) query = query.eq('status', status)
  if (tier) query = query.eq('tier', tier)
  if (search) {
    const s = sanitizeSearch(search)
    const numSearch = Number(search)
    if (numSearch) {
      query = query.or(`naam.ilike.%${s}%,debiteur_nr.eq.${numSearch}`)
    } else if (s) {
      query = query.ilike('naam', `%${s}%`)
    }
  }

  const { data, error, count } = await query
  if (error) throw error

  return { klanten: (data ?? []) as KlantRow[], totalCount: count ?? 0 }
}

/** Fetch single klant */
export async function fetchKlantDetail(debiteurNr: number): Promise<KlantDetail> {
  const { data, error } = await supabase
    .from('debiteuren')
    .select('*')
    .eq('debiteur_nr', debiteurNr)
    .single()

  if (error) throw error
  return data as KlantDetail
}

/** Fetch afleveradressen for a klant */
export async function fetchAfleveradressen(debiteurNr: number): Promise<Afleveradres[]> {
  const { data, error } = await supabase
    .from('afleveradressen')
    .select('id, adres_nr, naam, adres, postcode, plaats, land, telefoon, email, gln_afleveradres')
    .eq('debiteur_nr', debiteurNr)
    .order('adres_nr')

  if (error) throw error
  return (data ?? []) as Afleveradres[]
}
