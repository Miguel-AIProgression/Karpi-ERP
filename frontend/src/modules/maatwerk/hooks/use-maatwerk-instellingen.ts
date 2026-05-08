// Admin-mutations + reads voor vormen + afwerkingen. Wraps queries/maatwerk-instellingen.ts +
// queries/maatwerk-runtime.ts (voor fetchTypeBewerkingen). Combineert oude src/hooks/use-vormen.ts
// (3 exports) en src/hooks/use-afwerkingen.ts (4 exports) — zie ADR-0009.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchAlleVormen,
  upsertVorm,
  deleteVorm,
  fetchAlleAfwerkingTypes,
  upsertAfwerkingType,
  deleteAfwerkingType,
} from '../queries/maatwerk-instellingen'
import {
  fetchTypeBewerkingen,
  type MaatwerkVormRow,
  type AfwerkingTypeRow,
} from '../queries/maatwerk-runtime'

// ── Vormen ────────────────────────────────────────────────────────────────────

export function useAlleVormen() {
  return useQuery({
    queryKey: ['maatwerk-vormen', 'alle'],
    queryFn: fetchAlleVormen,
  })
}

export function useUpsertVorm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vorm: Omit<MaatwerkVormRow, 'id'> & { id?: number }) => upsertVorm(vorm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maatwerk-vormen'] })
    },
  })
}

export function useDeleteVorm() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteVorm(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maatwerk-vormen'] })
    },
  })
}

// ── Afwerkingen ───────────────────────────────────────────────────────────────

export function useAlleAfwerkingen() {
  return useQuery({
    queryKey: ['afwerking-types', 'alle'],
    queryFn: fetchAlleAfwerkingTypes,
  })
}

export function useTypeBewerkingen() {
  return useQuery({
    queryKey: ['confectie-werktijden', 'type-bewerkingen'],
    queryFn: fetchTypeBewerkingen,
  })
}

export function useUpsertAfwerking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (at: Omit<AfwerkingTypeRow, 'id'> & { id?: number }) => upsertAfwerkingType(at),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['afwerking-types'] })
    },
  })
}

export function useDeleteAfwerking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => deleteAfwerkingType(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['afwerking-types'] })
    },
  })
}
