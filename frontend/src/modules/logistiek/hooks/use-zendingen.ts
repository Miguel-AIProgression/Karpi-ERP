import { useQueries, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  startPickrondes,
  fetchZendingen,
  zoekZendingen,
  fetchZendingMetTransportorders,
  fetchZendingPrintSet,
  markeerZendingHandmatigAfgehandeld,
  markeerZendingAfgehaald,
  type ZendingenFilters,
  type ZendingPrintSet,
} from '@/modules/logistiek/queries/zendingen'

export function useZendingen(filters: ZendingenFilters = {}) {
  return useQuery({
    queryKey: ['logistiek', 'zendingen', filters],
    queryFn: async () => {
      const { data, error } = await fetchZendingen(filters)
      if (error) throw error
      return data ?? []
    },
    refetchInterval: 30_000, // poll elke 30s zodat tracking-updates binnenkomen
  })
}

/** Zoek zendingen op barcode/order/zending (zie `zoekZendingen`). */
export function useZoekZendingen(term: string) {
  const t = term.trim()
  return useQuery({
    queryKey: ['logistiek', 'zoek-zendingen', t],
    queryFn: async () => {
      const { data, error } = await zoekZendingen(t)
      if (error) throw error
      return data ?? []
    },
    enabled: t.length >= 2,
  })
}

export function useZending(zending_nr: string | undefined) {
  return useQuery({
    queryKey: ['logistiek', 'zending', zending_nr],
    queryFn: async () => {
      const { data, error } = await fetchZendingMetTransportorders(zending_nr!)
      if (error) throw error
      return data
    },
    enabled: !!zending_nr,
    refetchInterval: 30_000,
  })
}

export function useZendingPrintSet(zending_nr: string | undefined) {
  return useQuery({
    queryKey: ['logistiek', 'zending-printset', zending_nr],
    queryFn: () => fetchZendingPrintSet(zending_nr!),
    enabled: !!zending_nr,
  })
}

/**
 * Parallel fetch van meerdere zending-printsets in dezelfde volgorde als de
 * input. Gebruikt door de bulk-printset-pagina (`/logistiek/printset/bulk`)
 * waar één klik meerdere zendingen achter elkaar print.
 */
export function useZendingPrintSets(zending_nrs: string[]) {
  return useQueries({
    queries: zending_nrs.map((nr) => ({
      queryKey: ['logistiek', 'zending-printset', nr],
      queryFn: () => fetchZendingPrintSet(nr),
      enabled: !!nr,
    })),
    combine: (results) => ({
      data: results
        .map((r) => r.data)
        .filter((d): d is ZendingPrintSet => !!d),
      isLoading: results.some((r) => r.isLoading),
      hasError: results.some((r) => !!r.error),
      errors: results.map((r) => r.error).filter((e): e is Error => !!e),
    }),
  })
}

/**
 * Mig 248 (ADR-0012): canonieke mutation voor pickronde-start. Vervangt
 * de gedropte `useCreateZendingVoorOrder` (mig 249). Returnt een array met één rij per aangemaakte
 * zending — voor bundels één rij per vervoerder-groep, voor solo één rij per
 * vervoerder van de order. Caller navigeert na succes naar
 * `/logistiek/printset/bulk?zendingen=<nrs>`.
 */
export function useStartPickrondes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      orderIds,
      pickerId,
      forceSoloIds,
    }: {
      orderIds: number[]
      pickerId: number | null
      forceSoloIds?: number[]
    }) => startPickrondes(orderIds, pickerId, forceSoloIds ?? []),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logistiek', 'zendingen'] })
      qc.invalidateQueries({ queryKey: ['pick-ship'] })
      qc.invalidateQueries({ queryKey: ['logistiek', 'orderregel-vervoerder'] })
      // Mig 229: actieve zendingen vallen uit voorgestelde-bundels-view.
      qc.invalidateQueries({ queryKey: ['voorgestelde-bundels'] })
    },
  })
}

/**
 * Markeer een Fout-zending als afgehandeld zonder opnieuw naar de vervoerder te
 * versturen. Een HST-foutmelding betekent dat de zending tóch al in de portal
 * staat — opnieuw versturen dupliceert. De operator corrigeert de fout in HST
 * en sluit 'm hier af.
 */
export function useMarkeerZendingAfgehandeld() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: number; externRef: string | null; vervoerderCode: string | null }) =>
      markeerZendingHandmatigAfgehandeld(v.id, v.externRef, v.vervoerderCode),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logistiek', 'zending'] })
      qc.invalidateQueries({ queryKey: ['logistiek', 'zendingen'] })
      qc.invalidateQueries({ queryKey: ['hst-monitor'] })
      qc.invalidateQueries({ queryKey: ['hst-fouten'] })
    },
  })
}

/**
 * Markeer een afhaal-zending als afgehaald (mig 482-483). Voor afhaal-orders
 * zonder vervoerder, die anders op 'Klaar voor verzending' blijven hangen.
 */
export function useMarkeerZendingAfgehaald() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (zendingId: number) => markeerZendingAfgehaald(zendingId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logistiek', 'zending'] })
      qc.invalidateQueries({ queryKey: ['logistiek', 'zendingen'] })
    },
  })
}
