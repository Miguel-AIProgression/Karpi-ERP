import { useQuery } from '@tanstack/react-query'
import { fetchEmailsVoorOrder } from '@/lib/supabase/queries/verstuurde-emails'

export function useEmailsVoorOrder(orderId: number | undefined) {
  return useQuery({
    queryKey: ['verstuurde-emails', orderId],
    queryFn: () => fetchEmailsVoorOrder(orderId!),
    enabled: !!orderId,
  })
}
