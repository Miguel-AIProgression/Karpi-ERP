import { useQuery } from '@tanstack/react-query'
import { fetchProducten, fetchProductDetail, fetchRollenVoorProduct, type ProductType } from '@/lib/supabase/queries/producten'

export function useProducten(params: { search?: string; page?: number; productType?: ProductType | 'alle' }) {
  return useQuery({
    queryKey: ['producten', params],
    queryFn: () => fetchProducten(params),
  })
}

export function useProductDetail(artikelnr: string) {
  return useQuery({
    queryKey: ['producten', artikelnr],
    queryFn: () => fetchProductDetail(artikelnr),
    enabled: !!artikelnr,
  })
}

export function useRollenVoorProduct(artikelnr: string) {
  return useQuery({
    queryKey: ['producten', artikelnr, 'rollen'],
    queryFn: () => fetchRollenVoorProduct(artikelnr),
    enabled: !!artikelnr,
  })
}
