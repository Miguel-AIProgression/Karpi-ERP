import { supabase } from '../client'

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

export interface OpruimResult {
  verwijderde_orders: number
  verwijderde_berichten: number
}

export async function ruimEdiDemoData(): Promise<OpruimResult> {
  const { data, error } = await supabase.rpc('ruim_edi_demo_data').single()
  if (error) throw error
  return data as OpruimResult
}
