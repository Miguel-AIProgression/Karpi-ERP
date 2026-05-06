import { useQuery } from '@tanstack/react-query'
import {
  fetchRollen,
  fetchRollenStats,
  fetchRolDetail,
} from '@/lib/supabase/queries/rollen'
import type { RollenParams } from '@/lib/supabase/queries/rollen'

export function useRollen(params: RollenParams) {
  return useQuery({
    queryKey: ['rollen', params],
    queryFn: () => fetchRollen(params),
  })
}

export function useRollenStats() {
  return useQuery({
    queryKey: ['rollen', 'stats'],
    queryFn: fetchRollenStats,
  })
}

export function useRolDetail(id: number | null) {
  return useQuery({
    queryKey: ['rollen', id],
    queryFn: () => fetchRolDetail(id!),
    enabled: !!id,
  })
}
