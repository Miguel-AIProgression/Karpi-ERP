import { supabase } from '@/lib/supabase/client'
import { filterTeKoppelen } from '@/modules/edi/lib/te-koppelen'

export type EdiBerichtStatus = 'Wachtrij' | 'Bezig' | 'Verstuurd' | 'Verwerkt' | 'Fout' | 'Geannuleerd'
export type EdiRichting = 'in' | 'uit'
export type EdiBerichtType = 'order' | 'orderbev' | 'factuur' | 'verzendbericht'

export interface EdiBerichtListItem {
  id: number
  richting: EdiRichting
  berichttype: EdiBerichtType
  status: EdiBerichtStatus
  transactie_id: string | null
  debiteur_nr: number | null
  klant_naam?: string
  order_id: number | null
  order_nr?: string
  factuur_id: number | null
  factuur_nr?: string
  is_test: boolean
  retry_count: number
  error_msg: string | null
  ack_status: number | null
  created_at: string
  sent_at: string | null
  acked_at: string | null
}

export interface EdiBerichtDetail extends EdiBerichtListItem {
  payload_raw: string | null
  payload_parsed: Record<string, unknown> | null
  ack_details: string | null
  bron_tabel: string | null
  bron_id: number | null
  zending_id: number | null
  updated_at: string
}

export interface EdiHandelspartnerConfig {
  debiteur_nr: number
  transus_actief: boolean
  order_in: boolean
  orderbev_uit: boolean
  factuur_uit: boolean
  verzend_uit: boolean
  test_modus: boolean
  notities: string | null
  created_at: string
  updated_at: string
}

export interface EdiBerichtenFilters {
  richting?: EdiRichting
  status?: EdiBerichtStatus
  berichttype?: EdiBerichtType
  debiteurNr?: number
  zoek?: string
}

export async function fetchEdiBerichten(filters: EdiBerichtenFilters = {}): Promise<EdiBerichtListItem[]> {
  let q = supabase
    .from('edi_berichten')
    .select(`
      id, richting, berichttype, status, transactie_id, debiteur_nr,
      order_id, factuur_id, is_test, retry_count, error_msg, ack_status,
      created_at, sent_at, acked_at,
      debiteuren:debiteur_nr(naam),
      orders:order_id(order_nr),
      facturen:factuur_id(factuur_nr)
    `)
    .order('created_at', { ascending: false })
    .limit(500)

  if (filters.richting) q = q.eq('richting', filters.richting)
  if (filters.status) q = q.eq('status', filters.status)
  if (filters.berichttype) q = q.eq('berichttype', filters.berichttype)
  if (filters.debiteurNr) q = q.eq('debiteur_nr', filters.debiteurNr)
  if (filters.zoek) {
    q = q.or(
      `transactie_id.ilike.%${filters.zoek}%,error_msg.ilike.%${filters.zoek}%`,
    )
  }

  const { data, error } = await q
  if (error) throw error

  return (data ?? []).map((row: any) => ({
    id: row.id,
    richting: row.richting,
    berichttype: row.berichttype,
    status: row.status,
    transactie_id: row.transactie_id,
    debiteur_nr: row.debiteur_nr,
    klant_naam: row.debiteuren?.naam,
    order_id: row.order_id,
    order_nr: row.orders?.order_nr,
    factuur_id: row.factuur_id,
    factuur_nr: row.facturen?.factuur_nr,
    is_test: row.is_test,
    retry_count: row.retry_count,
    error_msg: row.error_msg,
    ack_status: row.ack_status,
    created_at: row.created_at,
    sent_at: row.sent_at,
    acked_at: row.acked_at,
  }))
}

/**
 * Telt inkomende EDI-orders die (nog) géén order werden — `order_id IS NULL`.
 *
 * Safety-net voor het orders-overzicht: zo'n bericht mag nooit alleen in de
 * EDI-module blijven hangen (operator leeft in Orders). Zelfde definitie als
 * `isTeKoppelen` in de berichten-overzicht: filtert op `order_id`, NIET op
 * status — de poll laat de status soms op 'Verwerkt' staan terwijl
 * order-creatie faalde (geen GLN-match).
 */
export async function countTeKoppelenEdiOrders(): Promise<number> {
  const { count, error } = await filterTeKoppelen(
    supabase.from('edi_berichten').select('id', { count: 'exact', head: true }),
  )
  if (error) throw error
  return count ?? 0
}

export async function fetchEdiBericht(id: number): Promise<EdiBerichtDetail | null> {
  const { data, error } = await supabase
    .from('edi_berichten')
    .select(`
      *,
      debiteuren:debiteur_nr(naam),
      orders:order_id(order_nr),
      facturen:factuur_id(factuur_nr)
    `)
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as any
  return {
    id: row.id,
    richting: row.richting,
    berichttype: row.berichttype,
    status: row.status,
    transactie_id: row.transactie_id,
    debiteur_nr: row.debiteur_nr,
    klant_naam: row.debiteuren?.naam,
    order_id: row.order_id,
    order_nr: row.orders?.order_nr,
    factuur_id: row.factuur_id,
    factuur_nr: row.facturen?.factuur_nr,
    is_test: row.is_test,
    retry_count: row.retry_count,
    error_msg: row.error_msg,
    ack_status: row.ack_status,
    created_at: row.created_at,
    sent_at: row.sent_at,
    acked_at: row.acked_at,
    payload_raw: row.payload_raw,
    payload_parsed: row.payload_parsed,
    ack_details: row.ack_details,
    bron_tabel: row.bron_tabel,
    bron_id: row.bron_id,
    zending_id: row.zending_id,
    updated_at: row.updated_at,
  }
}

export async function fetchHandelspartnerConfig(debiteurNr: number): Promise<EdiHandelspartnerConfig | null> {
  const { data, error } = await supabase
    .from('edi_handelspartner_config')
    .select('*')
    .eq('debiteur_nr', debiteurNr)
    .maybeSingle()
  if (error) throw error
  return data as EdiHandelspartnerConfig | null
}

export async function upsertHandelspartnerConfig(
  cfg: Omit<EdiHandelspartnerConfig, 'created_at' | 'updated_at'>,
): Promise<EdiHandelspartnerConfig> {
  const { data, error } = await supabase
    .from('edi_handelspartner_config')
    .upsert(cfg, { onConflict: 'debiteur_nr' })
    .select()
    .single()
  if (error) throw error
  return data as EdiHandelspartnerConfig
}

export interface EdiPartnerRow {
  debiteur_nr: number
  klant_naam: string | null
  transus_actief: boolean
  order_in: boolean
  orderbev_uit: boolean
  factuur_uit: boolean
  verzend_uit: boolean
  test_modus: boolean
}

/**
 * Alle EDI-handelspartners (config-rijen) met klantnaam — voor het centrale
 * overzicht "welke berichten gaan naar welke partner". Actieve partners eerst,
 * daarna op naam.
 */
export async function fetchEdiPartners(): Promise<EdiPartnerRow[]> {
  const { data, error } = await supabase
    .from('edi_handelspartner_config')
    .select(
      'debiteur_nr, transus_actief, order_in, orderbev_uit, factuur_uit, verzend_uit, test_modus, debiteuren:debiteur_nr(naam)',
    )
  if (error) throw error
  return (data ?? [])
    .map((r: any) => ({
      debiteur_nr: r.debiteur_nr,
      klant_naam: r.debiteuren?.naam ?? null,
      transus_actief: r.transus_actief,
      order_in: r.order_in,
      orderbev_uit: r.orderbev_uit,
      factuur_uit: r.factuur_uit,
      verzend_uit: r.verzend_uit,
      test_modus: r.test_modus,
    }))
    .sort(
      (a, b) =>
        Number(b.transus_actief) - Number(a.transus_actief) ||
        (a.klant_naam ?? '').localeCompare(b.klant_naam ?? ''),
    )
}

export interface KoppelDebiteurOptie {
  debiteur_nr: number
  naam: string
  plaats: string | null
  status: string
}

/**
 * Lichte debiteur-zoekopdracht voor de EDI-koppel-widget. Zoekt op naam of
 * debiteur_nr; alleen actieve debiteuren (centraal-gefactureerde filiaalorders
 * horen op de actieve hoofd-debiteur, niet op een inactieve AG).
 */
export async function fetchDebiteurenVoorKoppeling(zoek: string): Promise<KoppelDebiteurOptie[]> {
  const term = zoek.trim()
  let q = supabase
    .from('debiteuren')
    .select('debiteur_nr, naam, plaats, status')
    .eq('status', 'Actief')
    .order('naam')
    .limit(25)

  if (term) {
    const num = Number(term)
    if (Number.isInteger(num) && num > 0) {
      q = q.or(`naam.ilike.%${term}%,debiteur_nr.eq.${num}`)
    } else {
      q = q.ilike('naam', `%${term}%`)
    }
  }

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as KoppelDebiteurOptie[]
}

/**
 * Bootstrap-koppeling: koppel een inkomende order met onbekende aflever-GLN aan
 * een afleveradres. De RPC onthoudt de GLN op het adres en maakt de order aan.
 * Returnt het order_id.
 */
export async function koppelEdiAfleveradres(
  berichtId: number,
  debiteurNr: number,
  afleveradresId: number,
): Promise<number> {
  const { data, error } = await supabase.rpc('koppel_edi_afleveradres', {
    p_bericht_id: berichtId,
    p_debiteur_nr: debiteurNr,
    p_afleveradres_id: afleveradresId,
  })
  if (error) throw error
  return data as number
}

/**
 * Koppeling op factuur-GLN (mig 307): legt een onbekende gefactureerd/besteller-GLN
 * vast als alias van een debiteur en maakt de order aan. Voor centrale facturatie
 * met meerdere factuur-entiteiten (BDSK/XXXLutz). Returnt het order_id.
 */
export async function koppelEdiDebiteurAlias(
  berichtId: number,
  debiteurNr: number,
  gln: string,
  reden?: string,
): Promise<number> {
  const { data, error } = await supabase.rpc('koppel_edi_debiteur_alias', {
    p_bericht_id: berichtId,
    p_debiteur_nr: debiteurNr,
    p_gln: gln,
    p_reden: reden ?? null,
  })
  if (error) throw error
  return data as number
}

export interface OpruimResult {
  verwijderde_orders: number
  verwijderde_berichten: number
}

export async function ruimEdiDemoData(): Promise<OpruimResult> {
  const { data, error } = await supabase.rpc('ruim_edi_demo_data').single()
  if (error) throw error
  return data as OpruimResult
}

/**
 * Uitgaande EDI-berichten van een order, voor de Communicatie-tijdlijn op
 * order-detail. Bewust geen payload-velden (zwaar); de tijdlijn linkt door
 * naar het EDI-bericht-detail voor de volledige inhoud.
 */
export interface EdiUitgaandTijdlijnItem {
  id: number
  berichttype: string
  status: string
  is_test: boolean
  sent_at: string | null
  created_at: string
}

export async function fetchUitgaandeEdiBerichtenVoorOrder(
  orderId: number,
): Promise<EdiUitgaandTijdlijnItem[]> {
  const { data, error } = await supabase
    .from('edi_berichten')
    .select('id, berichttype, status, is_test, sent_at, created_at')
    .eq('order_id', orderId)
    .eq('richting', 'uit')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as EdiUitgaandTijdlijnItem[]
}

/**
 * Vindt het inkomende order-bericht dat bij een interne order hoort (mig 158:
 * edi_berichten.order_id = orders.id). Nodig om vanaf order-detail de
 * orderbev-bevestiging te kunnen aanroepen (payload_parsed = de partner-order).
 * Retourneert null voor niet-EDI-orders of als het bron-bericht ontbreekt.
 */
export async function fetchInkomendBerichtVoorOrder(
  orderId: number,
): Promise<EdiBerichtDetail | null> {
  const { data, error } = await supabase
    .from('edi_berichten')
    .select('id')
    .eq('order_id', orderId)
    .eq('richting', 'in')
    .eq('berichttype', 'order')
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  const row = data as { id: number } | null
  if (!row) return null
  return fetchEdiBericht(row.id)
}
