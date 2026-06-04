import { useMutation, useQueryClient } from '@tanstack/react-query'
import { bevestigConceptOrder, type BevestigConceptOrderInput } from '../queries/transities'

export function useBevestigConceptOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BevestigConceptOrderInput) => bevestigConceptOrder(input),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['order', vars.orderId] })
      qc.invalidateQueries({ queryKey: ['order-events', vars.orderId] })
    },
  })
}
