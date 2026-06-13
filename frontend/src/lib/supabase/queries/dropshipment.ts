import { supabase } from '@/lib/supabase/client'
import {
  DROPSHIP_KLEIN_ID,
  DROPSHIP_GROOT_ID,
  type DropshipPrijzen,
} from '@/lib/constants/dropshipment'

/**
 * Haalt de actuele dropship-kostenprijzen uit `producten.verkoopprijs`
 * (ADR-0018, data-driven). Gooit als een van beide artikelen ontbreekt of geen
 * verkoopprijs heeft — zo komt een onvolledige prijs nooit stil als €0 op een
 * orderregel; de aanroeper (order-form) blokkeert de keuze tot de query slaagt.
 */
export async function fetchDropshipPrijzen(): Promise<DropshipPrijzen> {
  const { data, error } = await supabase
    .from('producten')
    .select('artikelnr, verkoopprijs')
    .in('artikelnr', [DROPSHIP_KLEIN_ID, DROPSHIP_GROOT_ID])
  if (error) throw new Error(`Dropship-prijzen ophalen: ${error.message}`)

  const prijsVan = (artikelnr: string): number => {
    const rij = (data ?? []).find((r) => r.artikelnr === artikelnr)
    if (rij?.verkoopprijs == null) {
      throw new Error(`Dropship-prijs ontbreekt voor ${artikelnr} (producten.verkoopprijs leeg)`)
    }
    return Number(rij.verkoopprijs)
  }

  return { klein: prijsVan(DROPSHIP_KLEIN_ID), groot: prijsVan(DROPSHIP_GROOT_ID) }
}
