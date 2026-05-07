import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchKlantVervoerderConfig,
  upsertKlantVervoerderConfig,
  updateZendingVervoerderVoorOrder,
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
    mutationFn: async ({
      debiteur_nr,
      vervoerder_code,
      order_id,
    }: {
      debiteur_nr: number
      vervoerder_code: string | null
      /**
       * Optioneel: order waarvoor ook de lopende zending bijgewerkt moet worden,
       * zodat de sticker (zending_printset) meteen de gekozen vervoerder pakt.
       * Zonder `order_id` blijft het gedrag "alleen klant-default voor toekomst".
       */
      order_id?: number
    }) => {
      const klantRes = await upsertKlantVervoerderConfig(debiteur_nr, vervoerder_code)
      if (klantRes.error) throw klantRes.error
      if (typeof order_id === 'number') {
        const zendingRes = await updateZendingVervoerderVoorOrder(order_id, vervoerder_code)
        if (zendingRes.error) throw zendingRes.error
      }
      return klantRes
    },
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ['logistiek', 'vervoerder-config', vars.debiteur_nr] })
      qc.invalidateQueries({ queryKey: ['edi-handelspartner-config', vars.debiteur_nr] })
      if (typeof vars.order_id === 'number') {
        qc.invalidateQueries({ queryKey: ['logistiek', 'zending-printset'] })
        qc.invalidateQueries({ queryKey: ['logistiek', 'zending'] })
        qc.invalidateQueries({ queryKey: ['logistiek', 'zendingen'] })
      }
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
