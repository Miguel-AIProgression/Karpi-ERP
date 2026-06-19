import { supabase } from '@/lib/supabase/client'

export interface CbsExportRij {
  factuur_regel_id: number
  factuur_id: number
  factuur_nr: string
  factuurdatum: string
  partner_id: string | null
  land_bestemming: string | null
  land_oorsprong: string
  transactie: string
  vervoerswijze: string
  leveringsvoorwaarden: string
  goederencode: string | null
  netto_gewicht_kg: number
  bijzondere_maatstaf: number
  factuurwaarde: number
  factuurvaluta: string
  eigen_administratienummer: string
}

/**
 * Mig 448: CBS/Intrastat-verzendingen-export (buitenlandse verkoopfacturen,
 * btw_verlegd) voor de gegeven periode. Bron voor de "CBS-export"-knop op
 * /facturatie — vervangt de maandelijkse Basta-export ("fbacbs").
 */
export async function fetchCbsExport(vanDatum: string, totDatum: string): Promise<CbsExportRij[]> {
  const { data, error } = await supabase
    .from('cbs_intrastat_export')
    .select('*')
    .gte('factuurdatum', vanDatum)
    .lte('factuurdatum', totDatum)
    .order('factuur_nr', { ascending: true })
    .order('factuur_regel_id', { ascending: true })
  if (error) throw error
  return (data ?? []) as CbsExportRij[]
}
