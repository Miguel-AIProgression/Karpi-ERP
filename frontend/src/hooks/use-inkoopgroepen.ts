import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createInkoopgroep,
  deleteInkoopgroep,
  fetchInkoopgroepen,
  fetchInkoopgroepDetail,
  fetchInkoopgroepLeden,
  fetchKoppelbareDebiteuren,
  setDebiteurInkoopgroep,
  setDebiteurenInkoopgroep,
  updateInkoopgroep,
  type InkoopgroepFormData,
} from '@/lib/supabase/queries/inkoopgroepen'

export function useInkoopgroepen() {
  return useQuery({
    queryKey: ['inkoopgroepen'],
    queryFn: fetchInkoopgroepen,
  })
}

export function useInkoopgroepDetail(code: string | undefined) {
  return useQuery({
    queryKey: ['inkoopgroepen', code],
    queryFn: () => fetchInkoopgroepDetail(code!),
    enabled: !!code,
  })
}

export function useInkoopgroepLeden(code: string | undefined) {
  return useQuery({
    queryKey: ['inkoopgroepen', code, 'leden'],
    queryFn: () => fetchInkoopgroepLeden(code!),
    enabled: !!code,
  })
}

export function useKoppelbareDebiteuren() {
  return useQuery({
    queryKey: ['inkoopgroepen', 'koppelbare-debiteuren'],
    queryFn: fetchKoppelbareDebiteuren,
  })
}

export function useSetDebiteurInkoopgroep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ debiteurNr, code }: { debiteurNr: number; code: string | null }) =>
      setDebiteurInkoopgroep(debiteurNr, code),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['inkoopgroepen'] })
      qc.invalidateQueries({ queryKey: ['klanten'] })
      qc.invalidateQueries({ queryKey: ['klanten', vars.debiteurNr] })
    },
  })
}

export function useSetDebiteurenInkoopgroep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ debiteurNrs, code }: { debiteurNrs: number[]; code: string | null }) =>
      setDebiteurenInkoopgroep(debiteurNrs, code),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inkoopgroepen'] })
      qc.invalidateQueries({ queryKey: ['klanten'] })
    },
  })
}

export function useCreateInkoopgroep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: InkoopgroepFormData) => createInkoopgroep(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inkoopgroepen'] }),
  })
}

export function useUpdateInkoopgroep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ code, data }: { code: string; data: Omit<InkoopgroepFormData, 'code'> }) =>
      updateInkoopgroep(code, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inkoopgroepen'] }),
  })
}

export function useDeleteInkoopgroep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (code: string) => deleteInkoopgroep(code),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inkoopgroepen'] })
      qc.invalidateQueries({ queryKey: ['klanten'] })
    },
  })
}
