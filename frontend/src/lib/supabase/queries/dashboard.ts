import { supabase } from '../client'

export interface DashboardStats {
  aantal_producten: number
  beschikbare_rollen: number
  /** Inventory (Goldratt TOC): SUM(rollen.waarde) excl. status='verkocht'. Kapitaal vastgebonden in voorraad aan inkoopprijs. Zie migratie 084. */
  voorraadwaarde_inkoop: number
  /** Open verkooporders (pipeline): SUM(orders.totaal_bedrag) − SUM(VERZEND-regels), status NOT IN ('Verzonden','Geannuleerd'). Zie migratie 084. */
  voorraadwaarde_verkoop: number
  gemiddelde_marge_pct: number
  open_orders: number
  actie_vereist_orders: number
  actieve_klanten: number
  in_productie: number
  actieve_collecties: number
}

export interface RecenteOrder {
  id: number
  order_nr: string
  orderdatum: string
  status: string
  totaal_bedrag: number
  klant_naam: string
  debiteur_nr: number
}

const EMPTY_STATS: DashboardStats = {
  aantal_producten: 0, beschikbare_rollen: 0, voorraadwaarde_inkoop: 0,
  voorraadwaarde_verkoop: 0, gemiddelde_marge_pct: 0, open_orders: 0,
  actie_vereist_orders: 0, actieve_klanten: 0, in_productie: 0, actieve_collecties: 0,
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const { data, error } = await supabase
    .from('dashboard_stats')
    .select('*')
    .maybeSingle()

  if (error) throw error
  return (data as DashboardStats) ?? EMPTY_STATS
}

export async function fetchRecenteOrders(): Promise<RecenteOrder[]> {
  const { data, error } = await supabase
    .from('recente_orders')
    .select('*')
    .limit(15)

  if (error) throw error
  return (data ?? []) as RecenteOrder[]
}
