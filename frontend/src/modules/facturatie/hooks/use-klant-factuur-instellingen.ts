import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchKlantFactuurInstellingen,
  updateKlantFactuurInstellingen,
  type KlantFactuurInstellingen,
} from '../queries/klant-factuur-instellingen'

export function useKlantFactuurInstellingen(debiteur_nr: number | null) {
  return useQuery({
    queryKey: ['klant-factuur-instellingen', debiteur_nr],
    queryFn: () => fetchKlantFactuurInstellingen(debiteur_nr!),
    enabled: debiteur_nr != null,
  })
}

export function useUpdateKlantFactuurInstellingen() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { debiteur_nr: number; patch: Partial<KlantFactuurInstellingen> }) =>
      updateKlantFactuurInstellingen(vars.debiteur_nr, vars.patch),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['klant-factuur-instellingen', vars.debiteur_nr] })
      qc.invalidateQueries({ queryKey: ['klant', vars.debiteur_nr] })
    },
  })
}
