import { useQuery } from '@tanstack/react-query'
import { fetchDashboardStats, fetchRecenteOrders } from '@/lib/supabase/queries/dashboard'

export function useDashboardStats(enabled = true) {
  return useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: fetchDashboardStats,
    // Mig 489: niet vuren voor de externe vertegenwoordiger — dashboard_stats is
    // een globale aggregaat-view, niet per-rep gescoped (zou bedrijfsbrede cijfers
    // in de netwerk-respons lekken, ook al verbergt de UI de kaarten).
    enabled,
  })
}

export function useRecenteOrders() {
  return useQuery({
    queryKey: ['dashboard', 'recente-orders'],
    queryFn: fetchRecenteOrders,
  })
}
