import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchMedewerkers,
  createPicker,
  updateMedewerker,
  addRolToMedewerker,
  removeRolVanMedewerker,
  type Medewerker,
  type MedewerkerRol,
} from '@/lib/supabase/queries/medewerkers'

export function useMedewerkers(rol?: MedewerkerRol) {
  return useQuery({
    queryKey: ['medewerkers', rol ?? 'all'],
    queryFn: () => fetchMedewerkers(rol),
  })
}

/**
 * Vertegenwoordigers als smalle `{code, naam}`-shape voor selector-dropdowns
 * en filter-pickers. Verhuisd uit `use-klanten.ts` per ADR-0011 — woont
 * post-ADR-0004 hier omdat vertegenwoordiger een rol op een Medewerker is.
 */
export function useVertegenwoordigers() {
  return useQuery({
    queryKey: ['vertegenwoordigers'],
    queryFn: async () => {
      const meds = await fetchMedewerkers('vertegenwoordiger')
      return meds
        .filter((m) => m.code !== null)
        .map((m) => ({ code: m.code as string, naam: m.naam }))
    },
  })
}

export function useCreatePicker() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (naam: string) => createPicker(naam),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['medewerkers'] })
      qc.invalidateQueries({ queryKey: ['pickers'] })
    },
  })
}

export function useUpdateMedewerker() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: number
      patch: Partial<Pick<Medewerker, 'naam' | 'email' | 'telefoon' | 'actief'>>
    }) => updateMedewerker(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['medewerkers'] })
      qc.invalidateQueries({ queryKey: ['pickers'] })
    },
  })
}

export function useAddRol() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, rol }: { id: number; rol: MedewerkerRol }) =>
      addRolToMedewerker(id, rol),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['medewerkers'] }),
  })
}

export function useRemoveRol() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, rol }: { id: number; rol: MedewerkerRol }) =>
      removeRolVanMedewerker(id, rol),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['medewerkers'] }),
  })
}
