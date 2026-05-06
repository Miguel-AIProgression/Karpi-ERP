import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchPrijslijsten,
  fetchPrijslijstDetail,
  fetchPrijslijstRegels,
  fetchPrijslijstKlanten,
  fetchKoppelbareProductenVoorPrijslijst,
  addProductenAanPrijslijst,
  createPrijslijst,
  deletePrijslijst,
  removePrijslijstRegel,
  updatePrijslijstRegel,
  type CreatePrijslijstInput,
} from '@/lib/supabase/queries/prijslijsten'

export function usePrijslijsten() {
  return useQuery({
    queryKey: ['prijslijsten'],
    queryFn: fetchPrijslijsten,
  })
}

export function usePrijslijstDetail(nr: string) {
  return useQuery({
    queryKey: ['prijslijsten', nr],
    queryFn: () => fetchPrijslijstDetail(nr),
    enabled: !!nr,
  })
}

export function usePrijslijstRegels(nr: string) {
  return useQuery({
    queryKey: ['prijslijsten', nr, 'regels'],
    queryFn: () => fetchPrijslijstRegels(nr),
    enabled: !!nr,
  })
}

export function usePrijslijstKlanten(nr: string) {
  return useQuery({
    queryKey: ['prijslijsten', nr, 'klanten'],
    queryFn: () => fetchPrijslijstKlanten(nr),
    enabled: !!nr,
  })
}

export function useUpdatePrijsRegel(prijslijstNr: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, prijs }: { id: number; prijs: number }) =>
      updatePrijslijstRegel(id, prijs),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prijslijsten', prijslijstNr, 'regels'] })
    },
  })
}

export function useKoppelbareProductenVoorPrijslijst(prijslijstNr: string, search: string) {
  return useQuery({
    queryKey: ['prijslijsten', prijslijstNr, 'koppelbare-producten', search],
    queryFn: () => fetchKoppelbareProductenVoorPrijslijst(prijslijstNr, search),
    enabled: !!prijslijstNr,
    staleTime: 30_000,
  })
}

export function useAddProductenAanPrijslijst(prijslijstNr: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (producten: Parameters<typeof addProductenAanPrijslijst>[1]) =>
      addProductenAanPrijslijst(prijslijstNr, producten),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prijslijsten', prijslijstNr] })
      qc.invalidateQueries({ queryKey: ['prijslijsten'] })
    },
  })
}

export function useCreatePrijslijst() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreatePrijslijstInput) => createPrijslijst(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prijslijsten'] })
    },
  })
}

export function useDeletePrijslijst() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (nr: string) => deletePrijslijst(nr),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prijslijsten'] })
    },
  })
}

export function useRemovePrijslijstRegel(prijslijstNr: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (regelId: number) => removePrijslijstRegel(regelId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prijslijsten', prijslijstNr] })
      qc.invalidateQueries({ queryKey: ['prijslijsten'] })
    },
  })
}
