import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchVervoerders,
  fetchVervoerder,
  fetchVervoerderStats,
  fetchRecenteZendingenVervoerder,
  updateVervoerder,
  type VervoerderUpdateInput,
} from '@/modules/logistiek/queries/vervoerders'

const STALE_5_MIN = 5 * 60_000

export type VervoerderSelectieStatus =
  | 'selecteerbaar'
  | 'geen_actieve_vervoerder'
  | 'meerdere_actieve_vervoerders'

export interface ActieveVervoerderResultaat {
  code: string | null
  naam: string | null
  selectie_status: VervoerderSelectieStatus
  isLoading: boolean
}

/**
 * V1-logica: kiest de actieve vervoerder als precies één `actief=true` heeft.
 * Bij 0 of meer dan 1 actieve vervoerder valt de status terug op
 * `geen_actieve_vervoerder` / `meerdere_actieve_vervoerders`.
 *
 * Slot-pattern (ADR-0002): `<VervoerderTag />` consumeert deze hook zelf in
 * pick-context — geen data-coupling tussen magazijn en logistiek.
 */
export function useActieveVervoerder(): ActieveVervoerderResultaat {
  const { data, isLoading } = useVervoerders()
  const actief = (data ?? []).filter((v) => v.actief)
  if (actief.length === 1) {
    return {
      code: actief[0].code,
      naam: actief[0].display_naam,
      selectie_status: 'selecteerbaar',
      isLoading,
    }
  }
  return {
    code: null,
    naam: null,
    selectie_status:
      actief.length > 1 ? 'meerdere_actieve_vervoerders' : 'geen_actieve_vervoerder',
    isLoading,
  }
}

export function useVervoerders() {
  return useQuery({
    queryKey: ['logistiek', 'vervoerders', 'list'],
    queryFn: () => fetchVervoerders(),
    staleTime: STALE_5_MIN,
  })
}

export function useVervoerder(code: string | undefined) {
  return useQuery({
    queryKey: ['logistiek', 'vervoerder', code],
    queryFn: () => fetchVervoerder(code!),
    enabled: !!code,
    staleTime: STALE_5_MIN,
  })
}

export function useVervoerderStats() {
  return useQuery({
    queryKey: ['logistiek', 'vervoerder-stats'],
    queryFn: () => fetchVervoerderStats(),
    staleTime: 60_000,
  })
}

export function useRecenteZendingenVervoerder(code: string | undefined, limit = 10) {
  return useQuery({
    queryKey: ['logistiek', 'vervoerder-recente-zendingen', code, limit],
    queryFn: () => fetchRecenteZendingenVervoerder(code!, limit),
    enabled: !!code,
    staleTime: 30_000,
  })
}

export function useUpdateVervoerder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ code, data }: { code: string; data: VervoerderUpdateInput }) =>
      updateVervoerder(code, data),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ['logistiek', 'vervoerder', vars.code] })
      qc.invalidateQueries({ queryKey: ['logistiek', 'vervoerders', 'list'] })
      qc.invalidateQueries({ queryKey: ['logistiek', 'vervoerder-stats'] })
      // De oude lichtgewicht hook in `use-vervoerder-config.ts` cached ook onder
      // ['logistiek', 'vervoerders'] — gooi die ook leeg zodat dropdowns updaten.
      qc.invalidateQueries({ queryKey: ['logistiek', 'vervoerders'] })
    },
  })
}
