import { supabase } from '@/lib/supabase/client'
import { sanitizeSearch } from '@/lib/utils/sanitize'

export interface DebiteurRow {
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
  edi_actief: boolean
  edi_test_modus: boolean
  prijslijst_nr: string | null
  prijslijst_naam: string | null
}

export interface DebiteurDetail {
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
  /** Klant-niveau verzend-/T&T-e-mailadres (mig 369). Default voor orders.afl_email vóór email_overig. */
  email_verzend: string | null
  fax: string | null
  vertegenw_code: string | null
  vertegenwoordiger_naam?: string | null
  route: string | null
  rayon_naam: string | null
  prijslijst_nr: string | null
  prijslijst_naam?: string | null
  korting_pct: number
  betaalconditie: string | null
  btw_nummer: string | null
  gln_bedrijf: string | null
  omzet_ytd: number
  gratis_verzending: boolean
  afleverwijze: string | null
  verzendkosten: number
  verzend_drempel: number
  standaard_maat_werkdagen: number | null
  maatwerk_weken: number | null
  deelleveringen_toegestaan: boolean
  /** ADR 0014 / mig 244: standaard lever_type bij orderaanmaak ('week' B2B-default, 'datum' B2C). */
  default_lever_type: 'week' | 'datum'
  /** Mig 303: tapijt-stickers (148×106 mm, klant-facing) ook printen voor
   *  standaard (niet-maatwerk) artikelen bij de vervoerderslabels. */
  tapijt_sticker_bij_standaard: boolean
  btw_percentage: number
  inkoopgroep_code: string | null
  inkoopgroep_naam?: string | null
  edi_actief: boolean
  edi_test_modus: boolean
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

export async function fetchDebiteuren(params: {
  search?: string
  status?: string
  tier?: string
  vertegenw_code?: string
  edi_filter?: 'edi' | 'niet_edi'
  inkoopgroep_code?: string
  prijslijst_filter?: string | 'geen'
  page?: number
  pageSize?: number
}) {
  const { search, status, tier, vertegenw_code, edi_filter, inkoopgroep_code, prijslijst_filter, page = 0, pageSize = 50 } = params

  const { data: ediRows, error: ediErr } = await supabase
    .from('edi_handelspartner_config')
    .select('debiteur_nr, test_modus')
    .eq('transus_actief', true)
  if (ediErr) throw ediErr
  const ediMap = new Map<number, boolean>(
    (ediRows ?? []).map((r) => [r.debiteur_nr as number, r.test_modus as boolean]),
  )

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

  if (edi_filter === 'edi') {
    if (ediMap.size === 0) {
      return { debiteuren: [], totalCount: 0 }
    }
    query = query.in('debiteur_nr', Array.from(ediMap.keys()))
  } else if (edi_filter === 'niet_edi' && ediMap.size > 0) {
    query = query.not('debiteur_nr', 'in', `(${Array.from(ediMap.keys()).join(',')})`)
  }

  if (inkoopgroep_code) {
    const { data: leden, error: ledenErr } = await supabase
      .from('debiteuren')
      .select('debiteur_nr')
      .eq('inkoopgroep_code', inkoopgroep_code)
    if (ledenErr) throw ledenErr
    const ledenNrs = (leden ?? []).map((r) => r.debiteur_nr as number)
    if (ledenNrs.length === 0) {
      return { debiteuren: [], totalCount: 0 }
    }
    query = query.in('debiteur_nr', ledenNrs)
  }

  if (prijslijst_filter) {
    if (prijslijst_filter === 'geen') {
      const { data: geenPrijsRows, error: geenErr } = await supabase
        .from('debiteuren')
        .select('debiteur_nr')
        .is('prijslijst_nr', null)
      if (geenErr) throw geenErr
      const geenNrs = (geenPrijsRows ?? []).map((r) => r.debiteur_nr as number)
      if (geenNrs.length === 0) return { debiteuren: [], totalCount: 0 }
      query = query.in('debiteur_nr', geenNrs)
    } else {
      const { data: prijsRows, error: prijsErr } = await supabase
        .from('debiteuren')
        .select('debiteur_nr')
        .eq('prijslijst_nr', prijslijst_filter)
      if (prijsErr) throw prijsErr
      const prijsNrs = (prijsRows ?? []).map((r) => r.debiteur_nr as number)
      if (prijsNrs.length === 0) return { debiteuren: [], totalCount: 0 }
      query = query.in('debiteur_nr', prijsNrs)
    }
  }

  const { data, error, count } = await query
  if (error) throw error

  const debNrs = (data ?? []).map((r) => r.debiteur_nr as number)
  const prijslijstMap = new Map<number, { nr: string | null; naam: string | null }>()
  if (debNrs.length > 0) {
    const { data: prijsRows, error: prijsErr } = await supabase
      .from('debiteuren')
      .select('debiteur_nr, prijslijst_nr, prijslijst_headers(naam)')
      .in('debiteur_nr', debNrs)
    if (prijsErr) throw prijsErr
    for (const row of prijsRows ?? []) {
      const r = row as Record<string, unknown>
      const header = r.prijslijst_headers as { naam: string } | null
      prijslijstMap.set(r.debiteur_nr as number, {
        nr: (r.prijslijst_nr as string | null) ?? null,
        naam: header?.naam ?? null,
      })
    }
  }

  const debiteuren = (data ?? []).map((row: Record<string, unknown>) => {
    const debNr = row.debiteur_nr as number
    const prijs = prijslijstMap.get(debNr)
    return {
      ...(row as Omit<DebiteurRow, 'edi_actief' | 'edi_test_modus' | 'prijslijst_nr' | 'prijslijst_naam'>),
      edi_actief: ediMap.has(debNr),
      edi_test_modus: ediMap.get(debNr) ?? false,
      prijslijst_nr: prijs?.nr ?? null,
      prijslijst_naam: prijs?.naam ?? null,
    }
  })

  return { debiteuren, totalCount: count ?? 0 }
}

export async function fetchDebiteurDetail(debiteurNr: number): Promise<DebiteurDetail> {
  const ytdFrom = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10)

  const [klantRes, omzetRes, ediRes] = await Promise.all([
    supabase
      .from('debiteuren')
      .select('*, vertegenwoordigers(naam), inkoopgroepen(naam), prijslijst_headers(naam)')
      .eq('debiteur_nr', debiteurNr)
      .single(),
    supabase
      .from('orders')
      .select('totaal_bedrag')
      .eq('debiteur_nr', debiteurNr)
      .gte('orderdatum', ytdFrom)
      .neq('status', 'Geannuleerd'),
    supabase
      .from('edi_handelspartner_config')
      .select('transus_actief, test_modus')
      .eq('debiteur_nr', debiteurNr)
      .maybeSingle(),
  ])

  if (klantRes.error) throw klantRes.error
  if (ediRes.error) throw ediRes.error

  const row = klantRes.data as Record<string, unknown>
  const verteg = row.vertegenwoordigers as { naam: string } | null
  const inkgroep = row.inkoopgroepen as { naam: string } | null
  const prijsHdr = row.prijslijst_headers as { naam: string } | null
  const omzetYtd = (omzetRes.data ?? []).reduce(
    (sum, o) => sum + (Number(o.totaal_bedrag) || 0),
    0,
  )

  return {
    ...row,
    vertegenwoordiger_naam: verteg?.naam ?? null,
    inkoopgroep_naam: inkgroep?.naam ?? null,
    prijslijst_naam: prijsHdr?.naam ?? null,
    omzet_ytd: omzetYtd,
    edi_actief: ediRes.data?.transus_actief ?? false,
    edi_test_modus: ediRes.data?.test_modus ?? false,
  } as DebiteurDetail
}

export async function fetchAfleveradressen(debiteurNr: number): Promise<Afleveradres[]> {
  const { data, error } = await supabase
    .from('afleveradressen')
    .select('id, adres_nr, naam, adres, postcode, plaats, land, telefoon, email, gln_afleveradres')
    .eq('debiteur_nr', debiteurNr)
    .order('adres_nr')

  if (error) throw error
  return (data ?? []) as Afleveradres[]
}

export async function fetchKoppelbareDebiteurenMetPrijslijst() {
  const all: { debiteur_nr: number; naam: string; plaats: string | null; prijslijst_nr: string | null }[] = []
  const pageSize = 1000
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('debiteuren')
      .select('debiteur_nr, naam, plaats, prijslijst_nr')
      .eq('status', 'Actief')
      .order('naam')
      .range(from, from + pageSize - 1)
    if (error) throw error
    const batch = (data ?? []) as typeof all
    all.push(...batch)
    if (batch.length < pageSize) break
    from += pageSize
  }
  return all
}
