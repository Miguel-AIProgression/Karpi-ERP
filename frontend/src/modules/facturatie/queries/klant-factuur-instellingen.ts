import { supabase } from '@/lib/supabase/client'

export interface KlantFactuurInstellingen {
  btw_percentage: number
  btw_verlegd_intracom: boolean | null
  email_factuur: string | null
  /** Mig 528: klant-toeslag instellingen. */
  toeslag_actief: boolean
  toeslag_procent: number | null
  toeslag_omschrijving: string | null
  toeslag_begindatum: string | null  // ISO YYYY-MM-DD
  toeslag_einddatum: string | null   // ISO YYYY-MM-DD
}

export async function fetchKlantFactuurInstellingen(
  debiteur_nr: number,
): Promise<KlantFactuurInstellingen | null> {
  const { data, error } = await supabase
    .from('debiteuren')
    .select('btw_percentage, btw_verlegd_intracom, email_factuur, toeslag_actief, toeslag_procent, toeslag_omschrijving, toeslag_begindatum, toeslag_einddatum')
    .eq('debiteur_nr', debiteur_nr)
    .single()
  if (error) throw new Error(error.message)
  return data as KlantFactuurInstellingen | null
}

export async function updateKlantFactuurInstellingen(
  debiteur_nr: number,
  patch: Partial<KlantFactuurInstellingen>,
): Promise<void> {
  const { error } = await supabase
    .from('debiteuren')
    .update(patch)
    .eq('debiteur_nr', debiteur_nr)
  if (error) throw new Error(error.message)
}
