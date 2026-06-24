import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchProducten, fetchProductDetail, fetchRollenVoorProduct, fetchReserveringenVoorProduct, fetchClaimsVoorProduct, updateProductType, updateProductLocatie, fetchKwaliteiten, fetchKleurenVoorKwaliteit, fetchLeveranciers, createProduct, updateProduct, fetchNextArtikelnr, fetchDistincteVormen, fetchMaatwerkVormen, fetchBestaandeArtikelnrs, type ProductType, type VormCode, type ProductSortField, type SortDirection, type ProductFormData } from '@/lib/supabase/queries/producten'
import { fetchEquivalenteProducten } from '@/lib/supabase/queries/product-equivalents'

export { type VormCode }

export function useDistincteVormen() {
  return useQuery({
    queryKey: ['producten', 'distincte-vormen'],
    queryFn: fetchDistincteVormen,
    staleTime: 5 * 60 * 1000,
  })
}

/** Alle beschikbare vormen uit de master-tabel — voor een echte dropdown (niet alleen vormen al in gebruik). */
export function useMaatwerkVormen() {
  return useQuery({
    queryKey: ['producten', 'maatwerk-vormen'],
    queryFn: fetchMaatwerkVormen,
    staleTime: 10 * 60 * 1000,
  })
}

/** Live duplicate-check: welke van deze artikelnrs bestaan al? */
export function useBestaandeArtikelnrs(artikelnrs: string[]) {
  const key = [...artikelnrs].sort().join(',')
  return useQuery({
    queryKey: ['producten', 'bestaande-artikelnrs', key],
    queryFn: () => fetchBestaandeArtikelnrs(artikelnrs),
    enabled: artikelnrs.length > 0,
  })
}

export function useProducten(params: { search?: string; page?: number; pageSize?: number; productType?: ProductType | 'alle'; vormCode?: VormCode | 'rechthoek' | 'alle'; kwaliteitCode?: string | null; sortBy?: ProductSortField; sortDir?: SortDirection }) {
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

export function useClaimsVoorProduct(artikelnr: string) {
  return useQuery({
    queryKey: ['producten', artikelnr, 'claims'],
    queryFn: () => fetchClaimsVoorProduct(artikelnr),
    enabled: !!artikelnr,
  })
}

export function useEquivalenteProducten(artikelnr: string) {
  return useQuery({
    queryKey: ['producten', artikelnr, 'equivalenten'],
    queryFn: () => fetchEquivalenteProducten(artikelnr),
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

export function useKleurenVoorKwaliteit(kwaliteitCode: string | null) {
  return useQuery({
    queryKey: ['kleuren-voor-kwaliteit', kwaliteitCode],
    queryFn: () => fetchKleurenVoorKwaliteit(kwaliteitCode!),
    enabled: !!kwaliteitCode,
  })
}

export function useLeveranciers() {
  return useQuery({
    queryKey: ['leveranciers'],
    queryFn: fetchLeveranciers,
    staleTime: 10 * 60 * 1000,
  })
}

export function useNextArtikelnr(kwaliteit_code: string | null, kleur_code: string | null) {
  return useQuery({
    queryKey: ['next-artikelnr', kwaliteit_code, kleur_code],
    queryFn: () => fetchNextArtikelnr(kwaliteit_code, kleur_code),
    staleTime: 0,
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
