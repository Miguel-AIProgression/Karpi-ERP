import { supabase } from '@/lib/supabase/client'
import type { FactuurStatus } from './facturen'

export interface VerkoopoverzichtRij {
  factuur_id: number
  factuur_nr: string
  factuurdatum: string
  vervaldatum: string | null
  status: FactuurStatus
  bedrag_ex: number
  btw_bedrag: number
  totaal: number
  debiteur_nr: number
  naam1: string
  naam2: string
  adres: string | null
  postcode: string | null
  plaats: string | null
  land: string | null
  ordernummers: string | null
  klant_refs: string | null
}

// Statussen die in de export verschijnen. Concept (nog niet verstuurd) en
// Gecrediteerd (tegengeboekt) zijn geen omzet-bevestigde regels voor AFAS.
const EXPORT_STATUSSEN: FactuurStatus[] = [
  'Verstuurd',
  'Betaald',
  'Herinnering',
  'Aanmaning',
]

export async function fetchVerkoopoverzicht(
  vanDatum: string,
  totDatum: string,
): Promise<VerkoopoverzichtRij[]> {
  const { data, error } = await supabase
    .from('verkoopoverzicht_export')
    .select('*')
    .gte('factuurdatum', vanDatum)
    .lte('factuurdatum', totDatum)
    .in('status', EXPORT_STATUSSEN)
    .order('debiteur_nr', { ascending: true })
    .order('factuur_nr', { ascending: true })
  if (error) throw error
  return (data ?? []).map((r) => ({
    ...(r as VerkoopoverzichtRij),
    bedrag_ex: Number((r as { bedrag_ex: number | string }).bedrag_ex),
    btw_bedrag: Number((r as { btw_bedrag: number | string }).btw_bedrag),
    totaal: Number((r as { totaal: number | string }).totaal),
  }))
}
