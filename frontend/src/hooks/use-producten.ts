import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchProducten, fetchProductDetail, fetchRollenVoorProduct, updateProductType, type ProductType, type ProductSortField, type SortDirection } from '@/lib/supabase/queries/producten'

export function useProducten(params: { search?: string; page?: number; productType?: ProductType | 'alle'; sortBy?: ProductSortField; sortDir?: SortDirection }) {
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

export function useUpdateProductType() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ artikelnr, productType }: { artikelnr: string; productType: ProductType }) =>
      updateProductType(artikelnr, productType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['producten'] })
    },
  })
}
