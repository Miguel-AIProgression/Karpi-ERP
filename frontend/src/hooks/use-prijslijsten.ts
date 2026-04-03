import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchPrijslijsten,
  fetchPrijslijstDetail,
  fetchPrijslijstRegels,
  fetchPrijslijstKlanten,
  updatePrijslijstRegel,
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
