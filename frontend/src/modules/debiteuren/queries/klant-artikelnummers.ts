import { supabase } from '@/lib/supabase/client'

export interface KlantArtikelnummer {
  id: number
  artikelnr: string
  klant_artikel: string
  omschrijving: string | null
  product_omschrijving?: string | null
}

export async function fetchKlantArtikelnummers(debiteurNr: number): Promise<KlantArtikelnummer[]> {
  const { data, error } = await supabase
    .from('klant_artikelnummers')
    .select('id, artikelnr, klant_artikel, omschrijving, producten(omschrijving)')
    .eq('debiteur_nr', debiteurNr)
    .order('artikelnr')

  if (error) throw error

  return (data ?? []).map((row: Record<string, unknown>) => {
    const product = row.producten as { omschrijving: string } | null
    return {
      id: row.id as number,
      artikelnr: row.artikelnr as string,
      klant_artikel: row.klant_artikel as string,
      omschrijving: row.omschrijving as string | null,
      product_omschrijving: product?.omschrijving ?? null,
    }
  })
}
