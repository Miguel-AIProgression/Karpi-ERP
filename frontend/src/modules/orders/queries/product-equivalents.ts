import { supabase } from '../client'

export interface EquivalentProduct {
  artikelnr: string
  karpi_code: string | null
  omschrijving: string
  kwaliteit_code: string
  kleur_code: string
  vrije_voorraad: number
  besteld_inkoop: number
  verkoopprijs: number | null
}

/** Fetch all equivalent products for a given artikelnr (including out of stock) */
export async function fetchEquivalenteProducten(
  artikelnr: string
): Promise<EquivalentProduct[]> {
  const { data, error } = await supabase.rpc('zoek_equivalente_producten', {
    p_artikelnr: artikelnr,
    p_min_voorraad: 0,
  })

  if (error) throw error
  return (data ?? []) as EquivalentProduct[]
}
