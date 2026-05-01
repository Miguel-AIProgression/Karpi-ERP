import { supabase } from '@/lib/supabase/client'

/**
 * Vervoerder-row inclusief de Fase A-instellingen (mig 174).
 * `notities` bestond al; de overige kolommen zijn nieuw.
 */
export interface Vervoerder {
  code: string
  display_naam: string
  type: 'api' | 'edi'
  actief: boolean
  notities: string | null
  api_endpoint: string | null
  api_customer_id: string | null
  account_nummer: string | null
  kontakt_naam: string | null
  kontakt_email: string | null
  kontakt_telefoon: string | null
  tarief_notities: string | null
}

/**
 * Statistieken-row uit view `vervoerder_stats` (mig 174).
 *
 * `hst_aantal_*` is voorlopig alleen niet-NULL voor `code='hst_api'`. Voor
 * EDI-vervoerders volgt later iets vergelijkbaars uit `edi_berichten`.
 */
export interface VervoerderStats {
  code: string
  display_naam: string
  type: 'api' | 'edi'
  actief: boolean
  aantal_klanten: number
  aantal_zendingen_totaal: number
  aantal_zendingen_deze_maand: number
  hst_aantal_verstuurd: number
  hst_aantal_fout: number
}

export interface VervoerderUpdateInput {
  api_endpoint?: string | null
  api_customer_id?: string | null
  account_nummer?: string | null
  kontakt_naam?: string | null
  kontakt_email?: string | null
  kontakt_telefoon?: string | null
  tarief_notities?: string | null
  notities?: string | null
  actief?: boolean
}

const VERVOERDER_COLUMNS = `
  code, display_naam, type, actief, notities,
  api_endpoint, api_customer_id, account_nummer,
  kontakt_naam, kontakt_email, kontakt_telefoon,
  tarief_notities
`

/**
 * Alle vervoerders incl. Fase A-instellingen, gesorteerd op display-naam.
 */
export async function fetchVervoerders(): Promise<Vervoerder[]> {
  const { data, error } = await supabase
    .from('vervoerders')
    .select(VERVOERDER_COLUMNS)
    .order('display_naam')

  if (error) throw error
  return (data ?? []) as Vervoerder[]
}

/**
 * Eén vervoerder op `code` (PK).
 */
export async function fetchVervoerder(code: string): Promise<Vervoerder | null> {
  const { data, error } = await supabase
    .from('vervoerders')
    .select(VERVOERDER_COLUMNS)
    .eq('code', code)
    .maybeSingle()

  if (error) throw error
  return (data ?? null) as Vervoerder | null
}

/**
 * Statistieken uit view `vervoerder_stats`.
 */
export async function fetchVervoerderStats(): Promise<VervoerderStats[]> {
  const { data, error } = await supabase
    .from('vervoerder_stats')
    .select(
      'code, display_naam, type, actief, aantal_klanten, aantal_zendingen_totaal, aantal_zendingen_deze_maand, hst_aantal_verstuurd, hst_aantal_fout',
    )
    .order('display_naam')

  if (error) throw error
  return (data ?? []) as VervoerderStats[]
}

/**
 * Partial update op `vervoerders`. Alleen meegegeven velden worden geschreven.
 */
export async function updateVervoerder(code: string, data: VervoerderUpdateInput) {
  const { error } = await supabase.from('vervoerders').update(data).eq('code', code)
  if (error) throw error
}

/**
 * Recente zendingen die via deze vervoerder lopen.
 *
 * Koppeling: `zendingen → orders → debiteuren → edi_handelspartner_config`.
 * We gebruiken een filter op `edi_handelspartner_config.vervoerder_code` via
 * de geneste relatie en filteren daarna client-side de rijen die geen match
 * hebben (Supabase laat de niet-matchende rijen wél staan met `null`-config).
 */
export interface RecenteZending {
  id: number
  zending_nr: string
  status: string
  track_trace: string | null
  verzenddatum: string | null
  created_at: string
  klant_naam: string | null
  debiteur_nr: number | null
  order_nr: string | null
}

export async function fetchRecenteZendingenVervoerder(
  code: string,
  limit = 10,
): Promise<RecenteZending[]> {
  const { data, error } = await supabase
    .from('zendingen')
    .select(
      `
      id, zending_nr, status, track_trace, verzenddatum, created_at,
      orders!inner (
        order_nr, debiteur_nr,
        debiteuren!inner (
          naam
        )
      )
    `,
    )
    .eq('vervoerder_code', code)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  type Row = {
    id: number
    zending_nr: string
    status: string
    track_trace: string | null
    verzenddatum: string | null
    created_at: string
    orders:
      | {
          order_nr: string | null
          debiteur_nr: number | null
          debiteuren: { naam: string | null } | { naam: string | null }[] | null
        }
      | {
          order_nr: string | null
          debiteur_nr: number | null
          debiteuren: { naam: string | null } | { naam: string | null }[] | null
        }[]
      | null
  }

  return (data as Row[] | null ?? []).map((r) => {
    const orders = Array.isArray(r.orders) ? r.orders[0] : r.orders
    const deb = Array.isArray(orders?.debiteuren) ? orders?.debiteuren[0] : orders?.debiteuren
    return {
      id: r.id,
      zending_nr: r.zending_nr,
      status: r.status,
      track_trace: r.track_trace,
      verzenddatum: r.verzenddatum,
      created_at: r.created_at,
      klant_naam: deb?.naam ?? null,
      debiteur_nr: orders?.debiteur_nr ?? null,
      order_nr: orders?.order_nr ?? null,
    }
  })
}
