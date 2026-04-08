import { useQuery } from '@tanstack/react-query'
import {
  fetchMagazijnItems,
  fetchMagazijnStats,
} from '@/lib/supabase/queries/magazijn'
import type { MagazijnParams } from '@/lib/supabase/queries/magazijn'

export function useMagazijnItems(params: MagazijnParams) {
  return useQuery({
    queryKey: ['magazijn', params],
    queryFn: () => fetchMagazijnItems(params),
  })
}

export function useMagazijnStats() {
  return useQuery({
    queryKey: ['magazijn', 'stats'],
    queryFn: fetchMagazijnStats,
  })
}
