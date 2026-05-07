import { useQuery } from '@tanstack/react-query'
import { fetchPickers } from '@/lib/supabase/queries/medewerkers'

export function usePickers() {
  return useQuery({
    queryKey: ['pickers'],
    queryFn: fetchPickers,
    staleTime: 5 * 60 * 1000,
  })
}
