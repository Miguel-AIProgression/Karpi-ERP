import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchKlantVervoerderConfig,
  upsertKlantVervoerderConfig,
  fetchVervoerders,
} from '@/modules/logistiek/queries/vervoerder-config'

export function useKlantVervoerderConfig(debiteur_nr: number | undefined) {
  return useQuery({
    queryKey: ['logistiek', 'vervoerder-config', debiteur_nr],
    queryFn: async () => {
      const { data, error } = await fetchKlantVervoerderConfig(debiteur_nr!)
      if (error) throw error
      return data
    },
    enabled: typeof debiteur_nr === 'number' && debiteur_nr > 0,
  })
}

export function useUpsertKlantVervoerderConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      debiteur_nr,
      vervoerder_code,
    }: {
      debiteur_nr: number
      vervoerder_code: string | null
    }) => upsertKlantVervoerderConfig(debiteur_nr, vervoerder_code),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ['logistiek', 'vervoerder-config', vars.debiteur_nr] })
      qc.invalidateQueries({ queryKey: ['edi-handelspartner-config', vars.debiteur_nr] })
    },
  })
}

export function useVervoerders() {
  return useQuery({
    queryKey: ['logistiek', 'vervoerders'],
    queryFn: () => fetchVervoerders(),
    staleTime: 5 * 60_000, // wijzigt zelden
  })
}
