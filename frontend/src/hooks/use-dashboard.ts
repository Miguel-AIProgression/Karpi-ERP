import { useQuery } from '@tanstack/react-query'
import { fetchDashboardStats, fetchRecenteOrders } from '@/lib/supabase/queries/dashboard'

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: fetchDashboardStats,
  })
}

export function useRecenteOrders() {
  return useQuery({
    queryKey: ['dashboard', 'recente-orders'],
    queryFn: fetchRecenteOrders,
  })
}
