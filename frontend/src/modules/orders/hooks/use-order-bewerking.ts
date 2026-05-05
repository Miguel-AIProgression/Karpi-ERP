import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  updateOrderWithLines,
  updateOrderStatus,
  deleteOrder,
  updateRegelAfwerking,
} from '../queries/order-mutations'
import type { OrderFormData, OrderRegelFormData } from '../queries/order-mutations'

/**
 * Dunne wrapper-hook die de bestaande order-mutaties bundelt voor de
 * bewerk-flow. Zorgt voor geüniformeerde cache-invalidatie na elke mutatie.
 *
 * @param orderId - ID van de te bewerken order
 */
export function useOrderBewerking(orderId: number) {
  const queryClient = useQueryClient()

  function invalidateOrder() {
    queryClient.invalidateQueries({ queryKey: ['orders', orderId] })
    queryClient.invalidateQueries({ queryKey: ['orders', orderId, 'regels'] })
    queryClient.invalidateQueries({ queryKey: ['orders'] })
  }

  const updateOrder = useMutation({
    mutationFn: ({
      header,
      regels,
    }: {
      header: Partial<OrderFormData>
      regels: OrderRegelFormData[]
    }) => updateOrderWithLines(orderId, header, regels),
    onSuccess: invalidateOrder,
  })

  const updateStatus = useMutation({
    mutationFn: (status: string) => updateOrderStatus(orderId, status),
    onSuccess: invalidateOrder,
  })

  const verwijderOrder = useMutation({
    mutationFn: () => deleteOrder(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
  })

  const updateAfwerking = useMutation({
    mutationFn: ({
      regelId,
      afwerking,
      bandKleur,
    }: {
      regelId: number
      afwerking: string
      bandKleur: string | null
    }) => updateRegelAfwerking(regelId, afwerking, bandKleur),
    onSuccess: invalidateOrder,
  })

  return {
    updateOrder,
    updateStatus,
    verwijderOrder,
    updateAfwerking,
  }
}
