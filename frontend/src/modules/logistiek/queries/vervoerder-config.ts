import { supabase } from '@/lib/supabase/client'

export interface VervoerderRow {
  code: string
  display_naam: string
  type: 'api' | 'edi'
  actief: boolean
  notities: string | null
}

/**
 * Lees per-debiteur de gekozen vervoerder-code.
 * Geeft `null` terug als er nog geen `edi_handelspartner_config`-rij bestaat
 * voor deze debiteur (dan is `vervoerder_code` impliciet NULL = handmatige flow).
 */
export async function fetchKlantVervoerderConfig(debiteur_nr: number) {
  return await supabase
    .from('edi_handelspartner_config')
    .select('debiteur_nr, vervoerder_code')
    .eq('debiteur_nr', debiteur_nr)
    .maybeSingle()
}

/**
 * Schrijf de vervoerder-keuze. Upsert want `edi_handelspartner_config` heeft
 * unique constraint op `debiteur_nr`. Bij wijziging worden bestaande zendingen
 * niet gemigreerd; alleen nieuwe zendingen volgen de nieuwe waarde.
 */
export async function upsertKlantVervoerderConfig(
  debiteur_nr: number,
  vervoerder_code: string | null,
) {
  return await supabase
    .from('edi_handelspartner_config')
    .upsert({ debiteur_nr, vervoerder_code }, { onConflict: 'debiteur_nr' })
}

/**
 * Lees alle vervoerders (voor dropdown). Inactieve worden ook teruggegeven
 * zodat de UI een "uitgeschakeld"-state kan tonen met uitleg.
 */
export async function fetchVervoerders(): Promise<VervoerderRow[]> {
  const { data, error } = await supabase
    .from('vervoerders')
    .select('code, display_naam, type, actief, notities')
    .order('display_naam')

  if (error) throw error
  return (data ?? []) as VervoerderRow[]
}
