import { useMutation, useQueryClient } from '@tanstack/react-query'
import { markeerGeannuleerd, type MarkeerGeannuleerdInput } from '../queries/transities'

export function useMarkeerGeannuleerd() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: MarkeerGeannuleerdInput) => markeerGeannuleerd(input),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['order', vars.orderId] })
      qc.invalidateQueries({ queryKey: ['order-events', vars.orderId] })
    },
  })
}
