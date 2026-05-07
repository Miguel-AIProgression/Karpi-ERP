import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  deleteKlanteigenNaam,
  fetchKlanteigenVoorInkoopgroep,
  fetchKlanteigenVoorKlant,
  fetchKwaliteitCodes,
  updateKlanteigenNaam,
  upsertKlanteigenNaam,
  type KlanteigenInsert,
} from '@/lib/supabase/queries/klanteigen-namen'

export function useKlanteigenVoorKlant(debiteurNr: number | undefined) {
  return useQuery({
    queryKey: ['klanteigen-namen', 'klant', debiteurNr],
    queryFn: () => fetchKlanteigenVoorKlant(debiteurNr!),
    enabled: !!debiteurNr,
  })
}

export function useKlanteigenVoorInkoopgroep(code: string | undefined) {
  return useQuery({
    queryKey: ['klanteigen-namen', 'inkoopgroep', code],
    queryFn: () => fetchKlanteigenVoorInkoopgroep(code!),
    enabled: !!code,
  })
}

export function useKwaliteitCodes() {
  return useQuery({
    queryKey: ['kwaliteiten', 'codes'],
    queryFn: fetchKwaliteitCodes,
    staleTime: 60_000 * 10,
  })
}

function invalidate(qc: ReturnType<typeof useQueryClient>, row: KlanteigenInsert) {
  qc.invalidateQueries({ queryKey: ['klanteigen-namen'] })
  // Order-flow leest klant-eigen-naam ook in — invalideer betroffen orders
  if (row.debiteur_nr) {
    qc.invalidateQueries({ queryKey: ['klanten', row.debiteur_nr] })
  }
  if (row.inkoopgroep_code) {
    qc.invalidateQueries({ queryKey: ['inkoopgroepen', row.inkoopgroep_code] })
  }
}

export function useUpsertKlanteigenNaam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (row: KlanteigenInsert) => upsertKlanteigenNaam(row),
    onSuccess: (_data, vars) => invalidate(qc, vars),
  })
}

export function useUpdateKlanteigenNaam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: {
      id: number
      patch: { benaming?: string; omschrijving?: string | null; leverancier?: string | null; kleur_code?: string | null }
    }) => updateKlanteigenNaam(args.id, args.patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['klanteigen-namen'] }),
  })
}

export function useDeleteKlanteigenNaam() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteKlanteigenNaam(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['klanteigen-namen'] }),
  })
}
