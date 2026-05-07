import { supabase } from '../client'

export interface Betaalconditie {
  code: string
  naam: string
  dagen: number | null
  omschrijving: string | null
  actief: boolean
}

export interface BetaalconditieMetAantal extends Betaalconditie {
  aantal_klanten: number
}

export interface BetaalconditieInput {
  code: string
  naam: string
  dagen: number | null
  omschrijving: string | null
  actief: boolean
}

/** Alle betaalcondities — voor de instellingen-pagina (incl. inactieve + aantal_klanten). */
export async function fetchBetaalcondities(): Promise<BetaalconditieMetAantal[]> {
  const { data, error } = await supabase
    .from('betaalcondities_met_aantal_klanten')
    .select('*')
    .order('code')
  if (error) throw error
  return (data ?? []) as BetaalconditieMetAantal[]
}

/** Actieve betaalcondities — voor dropdowns op klant-detail. */
export async function fetchActieveBetaalcondities(): Promise<Betaalconditie[]> {
  const { data, error } = await supabase
    .from('betaalcondities')
    .select('code, naam, dagen, omschrijving, actief')
    .eq('actief', true)
    .order('code')
  if (error) throw error
  return (data ?? []) as Betaalconditie[]
}

export async function upsertBetaalconditie(input: BetaalconditieInput): Promise<void> {
  const { error } = await supabase
    .from('betaalcondities')
    .upsert({
      code: input.code,
      naam: input.naam,
      dagen: input.dagen,
      omschrijving: input.omschrijving,
      actief: input.actief,
    })
  if (error) throw error
}

export async function deleteBetaalconditie(code: string): Promise<void> {
  const { error } = await supabase.from('betaalcondities').delete().eq('code', code)
  if (error) throw error
}

/** Format een conditie naar het "{code} - {naam}"-formaat dat in
 *  debiteuren.betaalconditie staat (en dat de factuur-RPC parseert). */
export function formatBetaalconditie(c: Pick<Betaalconditie, 'code' | 'naam'>): string {
  return `${c.code} - ${c.naam}`
}

export interface KlantBetaalconditie {
  debiteur_nr: number
  naam: string
  plaats: string | null
  status: string
  betaalconditie: string | null
}

/** Klanten die een betaalconditie met deze code gebruiken — voor de modal
 *  achter het aantal-klanten-cijfer op /instellingen/betaalcondities. */
export async function fetchKlantenVoorBetaalconditie(code: string): Promise<KlantBetaalconditie[]> {
  const { data, error } = await supabase.rpc('klanten_voor_betaalconditie', { p_code: code })
  if (error) throw error
  return (data ?? []) as KlantBetaalconditie[]
}

/** Bulk-zet de betaalconditie op een lijst debiteuren. `value` moet het volledige
 *  "{code} - {naam}"-formaat zijn dat de factuur-RPC kan parseren — gebruik
 *  `formatBetaalconditie()` om dat samen te stellen. */
export async function bulkSetBetaalconditie(
  debiteurNrs: number[],
  value: string,
): Promise<void> {
  if (debiteurNrs.length === 0) return
  const { error } = await supabase
    .from('debiteuren')
    .update({ betaalconditie: value })
    .in('debiteur_nr', debiteurNrs)
  if (error) throw error
}
