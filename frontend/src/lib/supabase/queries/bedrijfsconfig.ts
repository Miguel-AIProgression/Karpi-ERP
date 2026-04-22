import { supabase } from '../client'

export interface BedrijfsConfig {
  bedrijfsnaam: string
  adres: string
  postcode: string
  plaats: string
  land: string
  telefoon: string
  email: string
  website: string
  kvk: string
  btw_nummer: string
  iban: string
  bic: string
  bank: string
  rekeningnummer: string
  betalingscondities_tekst: string
  fax?: string
}

export async function fetchBedrijfsConfig(): Promise<BedrijfsConfig> {
  const { data, error } = await supabase
    .from('app_config')
    .select('waarde')
    .eq('sleutel', 'bedrijfsgegevens')
    .single()
  if (error) throw error
  return data.waarde as BedrijfsConfig
}

export async function updateBedrijfsConfig(config: BedrijfsConfig): Promise<void> {
  const { error } = await supabase
    .from('app_config')
    .upsert(
      { sleutel: 'bedrijfsgegevens', waarde: config as unknown as Record<string, unknown> },
      { onConflict: 'sleutel' },
    )
  if (error) throw error
}
