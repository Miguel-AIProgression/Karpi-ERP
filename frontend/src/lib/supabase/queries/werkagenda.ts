// Werkagenda-configuratie (werktijden + vrije dagen) — app_config 'werkagenda'
// (mig 384). Eén rij voor alle clients: UI, check-levertijd (edge) en
// Pick & Ship lezen dezelfde kalender (plan 2026-06-12-werkagenda-een-bron).
import { supabase } from '../client'
import { STANDAARD_WERKTIJDEN, type Werktijden } from '@/lib/utils/bereken-agenda'

export async function fetchWerkagendaConfig(): Promise<Werktijden> {
  const { data, error } = await supabase
    .from('app_config')
    .select('waarde')
    .eq('sleutel', 'werkagenda')
    .maybeSingle()
  if (error) throw error
  return { ...STANDAARD_WERKTIJDEN, ...((data?.waarde ?? {}) as Partial<Werktijden>) }
}

export async function saveWerkagendaConfig(w: Werktijden): Promise<void> {
  const { error } = await supabase
    .from('app_config')
    .update({ waarde: w as unknown as Record<string, unknown> })
    .eq('sleutel', 'werkagenda')
  if (error) throw error
}
