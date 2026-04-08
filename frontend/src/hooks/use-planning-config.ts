import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchPlanningConfig, updatePlanningConfig } from '@/lib/supabase/queries/planning-config'
import type { PlanningConfig } from '@/lib/types/productie'

export function usePlanningConfig() {
  return useQuery({
    queryKey: ['planning-config'],
    queryFn: fetchPlanningConfig,
  })
}

export function useUpdatePlanningConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (config: PlanningConfig) => updatePlanningConfig(config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['planning-config'] })
    },
  })
}
