import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchVertegOverview,
  fetchVertegDetail,
  fetchVertegMaandomzet,
  fetchVertegKlanten,
  fetchVertegOrders,
  fetchKoppelbareDebiteurenMetVerteg,
  fetchVertegWerkdagen,
  setKlantVerteg,
  updateVerteg,
  upsertVertegWerkdag,
  deleteVertegWerkdag,
  type VertegWerkdag,
  type VertegDetail,
} from '@/lib/supabase/queries/vertegenwoordigers'

type Periode = 'YTD' | 'Q1' | 'Q2' | 'Q3' | 'Q4'

export function useVertegOverview(periode: Periode = 'YTD') {
  return useQuery({
    queryKey: ['vertegenwoordigers', 'overview', periode],
    queryFn: () => fetchVertegOverview(periode),
  })
}

export function useVertegDetail(code: string) {
  return useQuery({
    queryKey: ['vertegenwoordigers', code],
    queryFn: () => fetchVertegDetail(code),
    enabled: !!code,
  })
}

export function useVertegMaandomzet(code: string) {
  return useQuery({
    queryKey: ['vertegenwoordigers', code, 'maandomzet'],
    queryFn: () => fetchVertegMaandomzet(code),
    enabled: !!code,
  })
}

export function useVertegKlanten(code: string) {
  return useQuery({
    queryKey: ['vertegenwoordigers', code, 'klanten'],
    queryFn: () => fetchVertegKlanten(code),
    enabled: !!code,
  })
}

export function useVertegOrders(code: string, statusFilter?: string) {
  return useQuery({
    queryKey: ['vertegenwoordigers', code, 'orders', statusFilter],
    queryFn: () => fetchVertegOrders(code, statusFilter),
    enabled: !!code,
  })
}

export function useKoppelbareDebiteurenMetVerteg() {
  return useQuery({
    queryKey: ['klanten', 'koppelbare-met-verteg'],
    queryFn: fetchKoppelbareDebiteurenMetVerteg,
  })
}

export function useUpdateVerteg() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      code,
      patch,
    }: {
      code: string
      patch: Partial<Pick<VertegDetail, 'naam' | 'email' | 'telefoon' | 'actief'>>
    }) => updateVerteg(code, patch),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['vertegenwoordigers'] })
      qc.invalidateQueries({ queryKey: ['vertegenwoordigers', vars.code] })
    },
  })
}

export function useVertegWerkdagen(code: string) {
  return useQuery({
    queryKey: ['vertegenwoordigers', code, 'werkdagen'],
    queryFn: () => fetchVertegWerkdagen(code),
    enabled: !!code,
  })
}

export function useUpsertVertegWerkdag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ code, werkdag }: { code: string; werkdag: VertegWerkdag }) =>
      upsertVertegWerkdag(code, werkdag),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['vertegenwoordigers', vars.code, 'werkdagen'] })
    },
  })
}

export function useDeleteVertegWerkdag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ code, dagVanWeek }: { code: string; dagVanWeek: number }) =>
      deleteVertegWerkdag(code, dagVanWeek),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['vertegenwoordigers', vars.code, 'werkdagen'] })
    },
  })
}

export function useSetKlantVerteg() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ debiteurNr, code }: { debiteurNr: number; code: string | null }) =>
      setKlantVerteg(debiteurNr, code),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['klanten'] })
      qc.invalidateQueries({ queryKey: ['klanten', vars.debiteurNr] })
      qc.invalidateQueries({ queryKey: ['vertegenwoordigers'] })
    },
  })
}
