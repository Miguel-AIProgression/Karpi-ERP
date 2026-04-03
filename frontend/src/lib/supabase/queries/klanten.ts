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
  vertegenwoordiger_naam?: string | null
  route: string | null
  rayon_naam: string | null
  prijslijst_nr: string | null
  korting_pct: number
  betaalconditie: string | null
  btw_nummer: string | null
  gln_bedrijf: string | null
  omzet_ytd: number
  gratis_verzending: boolean
  afleverwijze: string | null
}

export interface KlanteigenNaam {
  id: number
  kwaliteit_code: string
  benaming: string
  omschrijving: string | null
  leverancier: string | null
}

export interface KlantArtikelnummer {
  id: number
  artikelnr: string
  klant_artikel: string
  omschrijving: string | null
  product_omschrijving?: string | null
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
  vertegenw_code?: string
  page?: number
  pageSize?: number
}) {
  const { search, status, tier, vertegenw_code, page = 0, pageSize = 50 } = params

  let query = supabase
    .from('klant_omzet_ytd')
    .select('*', { count: 'exact' })
    .order('omzet_ytd', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)

  if (status) query = query.eq('status', status)
  if (tier) query = query.eq('tier', tier)
  if (vertegenw_code) query = query.eq('vertegenw_code', vertegenw_code)
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

/** Fetch single klant with vertegenwoordiger naam */
export async function fetchKlantDetail(debiteurNr: number): Promise<KlantDetail> {
  const ytdFrom = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10)

  const [klantRes, omzetRes] = await Promise.all([
    supabase
      .from('debiteuren')
      .select('*, vertegenwoordigers(naam)')
      .eq('debiteur_nr', debiteurNr)
      .single(),
    supabase
      .from('orders')
      .select('totaal_bedrag')
      .eq('debiteur_nr', debiteurNr)
      .gte('orderdatum', ytdFrom)
      .neq('status', 'Geannuleerd'),
  ])

  if (klantRes.error) throw klantRes.error

  const row = klantRes.data as Record<string, unknown>
  const verteg = row.vertegenwoordigers as { naam: string } | null
  const omzetYtd = (omzetRes.data ?? []).reduce(
    (sum, o) => sum + (Number(o.totaal_bedrag) || 0),
    0,
  )

  return {
    ...row,
    vertegenwoordiger_naam: verteg?.naam ?? null,
    omzet_ytd: omzetYtd,
  } as KlantDetail
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

/** Fetch klanteigen namen (custom quality names) for a klant */
export async function fetchKlanteigenNamen(debiteurNr: number): Promise<KlanteigenNaam[]> {
  const { data, error } = await supabase
    .from('klanteigen_namen')
    .select('id, kwaliteit_code, benaming, omschrijving, leverancier')
    .eq('debiteur_nr', debiteurNr)
    .order('kwaliteit_code')

  if (error) throw error
  return (data ?? []) as KlanteigenNaam[]
}

/** Fetch klant artikelnummers (customer-specific article numbers) for a klant */
export async function fetchKlantArtikelnummers(debiteurNr: number): Promise<KlantArtikelnummer[]> {
  const { data, error } = await supabase
    .from('klant_artikelnummers')
    .select('id, artikelnr, klant_artikel, omschrijving, producten(omschrijving)')
    .eq('debiteur_nr', debiteurNr)
    .order('artikelnr')

  if (error) throw error

  return (data ?? []).map((row: Record<string, unknown>) => {
    const product = row.producten as { omschrijving: string } | null
    return {
      id: row.id as number,
      artikelnr: row.artikelnr as string,
      klant_artikel: row.klant_artikel as string,
      omschrijving: row.omschrijving as string | null,
      product_omschrijving: product?.omschrijving ?? null,
    }
  })
}

export interface PrijslijstRegel {
  artikelnr: string
  omschrijving: string | null
  omschrijving_2: string | null
  prijs: number
  gewicht: number | null
}

/** Fetch prijslijst regels for a klant (via debiteuren.prijslijst_nr) */
export async function fetchKlantPrijslijst(debiteurNr: number): Promise<PrijslijstRegel[]> {
  // First get the klant's prijslijst_nr
  const { data: klant, error: klantError } = await supabase
    .from('debiteuren')
    .select('prijslijst_nr')
    .eq('debiteur_nr', debiteurNr)
    .single()

  if (klantError) throw klantError
  if (!klant?.prijslijst_nr) return []

  // Paginate to fetch all rows (Supabase default limit is 1000)
  const allRows: PrijslijstRegel[] = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('prijslijst_regels')
      .select('artikelnr, omschrijving, omschrijving_2, prijs, gewicht')
      .eq('prijslijst_nr', klant.prijslijst_nr)
      .order('artikelnr')
      .range(offset, offset + pageSize - 1)

    if (error) throw error
    allRows.push(...((data ?? []) as PrijslijstRegel[]))
    if (!data || data.length < pageSize) break
    offset += pageSize
  }
  return allRows
}

/** Fetch all vertegenwoordigers (for filter dropdown) */
export async function fetchVertegenwoordigers() {
  const { data, error } = await supabase
    .from('vertegenwoordigers')
    .select('code, naam')
    .order('naam')

  if (error) throw error
  return (data ?? []) as { code: string; naam: string }[]
}
