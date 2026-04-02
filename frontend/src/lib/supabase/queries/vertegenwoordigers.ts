import { supabase } from '../client'

const ACTIVE_ORDER_STATUSES = [
  'Nieuw',
  'Actie vereist',
  'Wacht op picken',
  'Wacht op voorraad',
  'In snijplan',
  'In productie',
  'Deels gereed',
  'Klaar voor verzending',
]

export interface VertegOverviewRow {
  code: string
  naam: string
  email: string | null
  telefoon: string | null
  actief: boolean
  omzet: number
  pct_totaal: number
  aantal_klanten: number
  open_orders: number
  gem_orderwaarde: number
  tier_gold: number
  tier_silver: number
  tier_bronze: number
}

export interface VertegDetail {
  code: string
  naam: string
  email: string | null
  telefoon: string | null
  actief: boolean
  omzet_ytd: number
  aantal_klanten: number
  open_orders: number
  gem_orderwaarde: number
}

export interface VertegMaandomzet {
  maand: number
  omzet: number
}

export interface VertegKlant {
  debiteur_nr: number
  naam: string
  tier: string
  omzet_ytd: number
  aantal_orders_ytd: number
  plaats: string | null
}

export interface VertegOrder {
  id: number
  order_nr: string
  debiteur_nr: number
  klant_naam: string | null
  orderdatum: string
  status: string
  totaal_bedrag: number
}

type Periode = 'YTD' | 'Q1' | 'Q2' | 'Q3' | 'Q4'

function periodeRange(periode: Periode): { from: string; to: string } {
  const year = new Date().getFullYear()
  switch (periode) {
    case 'Q1': return { from: `${year}-01-01`, to: `${year}-03-31` }
    case 'Q2': return { from: `${year}-04-01`, to: `${year}-06-30` }
    case 'Q3': return { from: `${year}-07-01`, to: `${year}-09-30` }
    case 'Q4': return { from: `${year}-10-01`, to: `${year}-12-31` }
    case 'YTD':
    default:
      return { from: `${year}-01-01`, to: new Date().toISOString().slice(0, 10) }
  }
}

/** Fetch all vertegenwoordigers with aggregated stats */
export async function fetchVertegOverview(periode: Periode = 'YTD'): Promise<VertegOverviewRow[]> {
  const { from, to } = periodeRange(periode)

  // Fetch all vertegenwoordigers
  const { data: vertegen, error: vErr } = await supabase
    .from('vertegenwoordigers')
    .select('code, naam, email, telefoon, actief')
    .order('naam')

  if (vErr) throw vErr

  // Fetch omzet per vertegenwoordiger in period (excluding cancelled)
  const { data: omzetData, error: oErr } = await supabase
    .from('orders')
    .select('vertegenw_code, totaal_bedrag, id')
    .gte('orderdatum', from)
    .lte('orderdatum', to)
    .neq('status', 'Geannuleerd')

  if (oErr) throw oErr

  // Aggregate omzet per code
  const omzetMap = new Map<string, { total: number; count: number }>()
  for (const o of omzetData ?? []) {
    const code = o.vertegenw_code as string | null
    if (!code) continue
    const cur = omzetMap.get(code) ?? { total: 0, count: 0 }
    cur.total += Number(o.totaal_bedrag) || 0
    cur.count += 1
    omzetMap.set(code, cur)
  }

  const totalOmzet = Array.from(omzetMap.values()).reduce((s, v) => s + v.total, 0)

  // Fetch open orders count per vertegenwoordiger (no date filter)
  const { data: openData, error: opErr } = await supabase
    .from('orders')
    .select('vertegenw_code, id')
    .in('status', ACTIVE_ORDER_STATUSES)

  if (opErr) throw opErr

  const openMap = new Map<string, number>()
  for (const o of openData ?? []) {
    const code = o.vertegenw_code as string | null
    if (!code) continue
    openMap.set(code, (openMap.get(code) ?? 0) + 1)
  }

  // Fetch klanten + tier per vertegenwoordiger
  const { data: klantenData, error: kErr } = await supabase
    .from('klant_omzet_ytd')
    .select('vertegenw_code, tier')

  if (kErr) throw kErr

  const klantMap = new Map<string, { total: number; gold: number; silver: number; bronze: number }>()
  for (const k of klantenData ?? []) {
    const code = k.vertegenw_code as string | null
    if (!code) continue
    const cur = klantMap.get(code) ?? { total: 0, gold: 0, silver: 0, bronze: 0 }
    cur.total += 1
    if (k.tier === 'Gold') cur.gold += 1
    else if (k.tier === 'Silver') cur.silver += 1
    else if (k.tier === 'Bronze') cur.bronze += 1
    klantMap.set(code, cur)
  }

  // Merge everything
  const rows: VertegOverviewRow[] = (vertegen ?? []).map((v) => {
    const omzet = omzetMap.get(v.code)
    const klant = klantMap.get(v.code)
    const open = openMap.get(v.code) ?? 0
    const total = omzet?.total ?? 0
    const count = omzet?.count ?? 0

    return {
      code: v.code,
      naam: v.naam,
      email: v.email,
      telefoon: v.telefoon,
      actief: v.actief,
      omzet: total,
      pct_totaal: totalOmzet > 0 ? (total / totalOmzet) * 100 : 0,
      aantal_klanten: klant?.total ?? 0,
      open_orders: open,
      gem_orderwaarde: count > 0 ? total / count : 0,
      tier_gold: klant?.gold ?? 0,
      tier_silver: klant?.silver ?? 0,
      tier_bronze: klant?.bronze ?? 0,
    }
  })

  // Sort by omzet desc
  rows.sort((a, b) => b.omzet - a.omzet)

  return rows
}

/** Fetch single vertegenwoordiger detail */
export async function fetchVertegDetail(code: string): Promise<VertegDetail> {
  const { data, error } = await supabase
    .from('vertegenwoordigers')
    .select('code, naam, email, telefoon, actief')
    .eq('code', code)
    .single()

  if (error) throw error

  const year = new Date().getFullYear()
  const ytdFrom = `${year}-01-01`
  const ytdTo = new Date().toISOString().slice(0, 10)

  // Omzet YTD
  const { data: omzetData } = await supabase
    .from('orders')
    .select('totaal_bedrag, id')
    .eq('vertegenw_code', code)
    .gte('orderdatum', ytdFrom)
    .lte('orderdatum', ytdTo)
    .neq('status', 'Geannuleerd')

  const totalOmzet = (omzetData ?? []).reduce((s, o) => s + (Number(o.totaal_bedrag) || 0), 0)
  const orderCount = omzetData?.length ?? 0

  // Open orders
  const { count: openCount } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('vertegenw_code', code)
    .in('status', ACTIVE_ORDER_STATUSES)

  // Aantal klanten
  const { count: klantCount } = await supabase
    .from('debiteuren')
    .select('debiteur_nr', { count: 'exact', head: true })
    .eq('vertegenw_code', code)
    .eq('status', 'Actief')

  return {
    ...data,
    omzet_ytd: totalOmzet,
    aantal_klanten: klantCount ?? 0,
    open_orders: openCount ?? 0,
    gem_orderwaarde: orderCount > 0 ? totalOmzet / orderCount : 0,
  }
}

/** Fetch monthly revenue for trend bars */
export async function fetchVertegMaandomzet(code: string): Promise<VertegMaandomzet[]> {
  const year = new Date().getFullYear()
  const currentMonth = new Date().getMonth() + 1

  const { data, error } = await supabase
    .from('orders')
    .select('orderdatum, totaal_bedrag')
    .eq('vertegenw_code', code)
    .gte('orderdatum', `${year}-01-01`)
    .lte('orderdatum', `${year}-12-31`)
    .neq('status', 'Geannuleerd')

  if (error) throw error

  // Aggregate per month
  const monthMap = new Map<number, number>()
  for (const o of data ?? []) {
    const month = new Date(o.orderdatum).getMonth() + 1
    monthMap.set(month, (monthMap.get(month) ?? 0) + (Number(o.totaal_bedrag) || 0))
  }

  // Return Jan through current month
  const result: VertegMaandomzet[] = []
  for (let m = 1; m <= currentMonth; m++) {
    result.push({ maand: m, omzet: monthMap.get(m) ?? 0 })
  }
  return result
}

/** Fetch klanten for a vertegenwoordiger */
export async function fetchVertegKlanten(code: string): Promise<VertegKlant[]> {
  const { data, error } = await supabase
    .from('klant_omzet_ytd')
    .select('debiteur_nr, naam, tier, omzet_ytd, aantal_orders_ytd, plaats')
    .eq('vertegenw_code', code)
    .order('omzet_ytd', { ascending: false })

  if (error) throw error
  return (data ?? []) as VertegKlant[]
}

/** Fetch orders for a vertegenwoordiger */
export async function fetchVertegOrders(code: string, statusFilter?: string): Promise<VertegOrder[]> {
  let query = supabase
    .from('orders_list')
    .select('id, order_nr, debiteur_nr, klant_naam, orderdatum, status, totaal_bedrag')
    .eq('vertegenw_code', code)
    .order('orderdatum', { ascending: false })
    .limit(100)

  if (statusFilter === 'open') {
    query = query.in('status', ACTIVE_ORDER_STATUSES)
  } else if (statusFilter === 'afgerond') {
    query = query.in('status', ['Verzonden', 'Geannuleerd'])
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as VertegOrder[]
}
