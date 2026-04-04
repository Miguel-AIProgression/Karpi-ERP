import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchProducten, fetchProductDetail, fetchRollenVoorProduct, fetchReserveringenVoorProduct, updateProductType, updateProductLocatie, fetchUitwisselbareGroepen, fetchKwaliteiten, fetchLeveranciers, createProduct, updateProduct, type ProductType, type ProductSortField, type SortDirection, type ProductFormData } from '@/lib/supabase/queries/producten'

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

export function useReserveringenVoorProduct(artikelnr: string) {
  return useQuery({
    queryKey: ['producten', artikelnr, 'reserveringen'],
    queryFn: () => fetchReserveringenVoorProduct(artikelnr),
    enabled: !!artikelnr,
  })
}

export function useKwaliteiten() {
  return useQuery({
    queryKey: ['kwaliteiten'],
    queryFn: fetchKwaliteiten,
    staleTime: 10 * 60 * 1000,
  })
}

export function useLeveranciers() {
  return useQuery({
    queryKey: ['leveranciers'],
    queryFn: fetchLeveranciers,
    staleTime: 10 * 60 * 1000,
  })
}

export function useCreateProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: ProductFormData) => createProduct(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['producten'] }),
  })
}

export function useUpdateProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ artikelnr, data }: { artikelnr: string; data: Partial<Omit<ProductFormData, 'artikelnr'>> }) =>
      updateProduct(artikelnr, data),
    onSuccess: (_r, { artikelnr }) => {
      queryClient.invalidateQueries({ queryKey: ['producten'] })
      queryClient.invalidateQueries({ queryKey: ['producten', artikelnr] })
    },
  })
}

export function useUitwisselbareGroepen() {
  return useQuery({
    queryKey: ['uitwisselbare-groepen'],
    queryFn: fetchUitwisselbareGroepen,
    staleTime: 5 * 60 * 1000,
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

export function useUpdateProductLocatie() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ artikelnr, locatie }: { artikelnr: string; locatie: string | null }) =>
      updateProductLocatie(artikelnr, locatie),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['producten'] })
    },
  })
}
