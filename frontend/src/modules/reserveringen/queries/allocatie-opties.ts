import { supabase } from '@/lib/supabase/client'
import type { ClaimBron } from './reserveringen'

export interface AllocatieOptie {
  bron: ClaimBron
  artikelnr: string
  omschrijving: string
  inkooporder_regel_id: number | null
  vrij_aantal: number
  verwacht_datum: string | null
  /** Constant over alle rijen — het (eventueel doos→stuks vertaalde, mig 408)
   *  eigen artikel van de orderregel. Onderscheidt optie 2 (eigen artikel
   *  wacht op inkoop) van optie 1/3 (equivalent) zonder dat de frontend de
   *  doos→stuks-vertaling zelf moet herhalen. Mig 493. */
  eigen_artikelnr: string
}

/**
 * Live databron voor de 3-soorten allocatie-keuze (mig 491/493): equivalent
 * nu op voorraad, eigen artikel wacht op inkoop, equivalent wacht op zíjn
 * inkoop — gesorteerd op levertijd door de aanroeper. Pure, herevaluerende
 * RPC (geen state/snapshot).
 */
export async function fetchAllocatieOpties(artikelnr: string): Promise<AllocatieOptie[]> {
  const { data, error } = await supabase.rpc('allocatie_opties_voor_artikel', {
    p_artikelnr: artikelnr,
  })
  if (error) throw error
  return (data ?? []) as AllocatieOptie[]
}
