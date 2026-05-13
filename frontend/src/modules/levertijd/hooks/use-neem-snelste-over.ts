// Mutation-hook: neem een door `levertijd_snelste_haalbaar` voorgestelde
// ISO-week over op een order. Zet `orders.afleverdatum` op de vrijdag van
// die ISO-week (matchend met `verzendWeekStringToDatum`). De trigger uit
// mig 276 herrekent `levertijd_status` automatisch naar
// `eerder_dan_standaard` of `later_dan_standaard` op basis van de
// bevroren snapshot.
//
// Schrijfpad: direct `supabase.from('orders').update(...)`. We gebruiken
// hier opzettelijk niet `updateOrderWithLines`-RPC — die schrijft álle
// regels weer en triggert de hele claim-keten, terwijl wij alleen de
// header-datum nodig hebben. De trigger uit mig 276 doet de status-derive
// "gratis" mee binnen dezelfde UPDATE-statement.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { verzendWeekStringToDatum } from '@/lib/orders/verzendweek'
import { invalidateNaLevertijdMutatie } from '../cache'

export interface NeemSnelsteOverInput {
  orderId: number
  /** ISO-week-string 'YYYY-Www' — wordt naar vrijdag van die week vertaald. */
  gekozenWeek: string
}

export interface NeemSnelsteOverResult {
  orderId: number
  nieuweAfleverdatum: string
}

async function neemSnelsteOver(
  input: NeemSnelsteOverInput,
): Promise<NeemSnelsteOverResult> {
  const nieuweDatum = verzendWeekStringToDatum(input.gekozenWeek)
  if (!nieuweDatum) {
    throw new Error(`Ongeldige ISO-week-string: ${input.gekozenWeek}`)
  }
  const { error } = await supabase
    .from('orders')
    .update({ afleverdatum: nieuweDatum })
    .eq('id', input.orderId)
  if (error) throw error
  return { orderId: input.orderId, nieuweAfleverdatum: nieuweDatum }
}

export function useNeemSnelsteOver() {
  const qc = useQueryClient()
  return useMutation<NeemSnelsteOverResult, Error, NeemSnelsteOverInput>({
    mutationFn: neemSnelsteOver,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['orders'] })
      qc.invalidateQueries({ queryKey: ['order', res.orderId] })
      invalidateNaLevertijdMutatie(qc)
    },
  })
}
