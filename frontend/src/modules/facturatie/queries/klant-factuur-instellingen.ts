import { supabase } from '@/lib/supabase/client'

export interface KlantFactuurInstellingen {
  btw_percentage: number
  email_factuur: string | null
}

export async function fetchKlantFactuurInstellingen(
  debiteur_nr: number,
): Promise<KlantFactuurInstellingen | null> {
  const { data, error } = await supabase
    .from('debiteuren')
    .select('btw_percentage, email_factuur')
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
