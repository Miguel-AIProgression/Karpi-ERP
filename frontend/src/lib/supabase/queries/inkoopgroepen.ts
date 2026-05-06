import { supabase } from '../client'

export interface InkoopgroepRow {
  code: string
  naam: string
  actief: boolean
  aantal_leden: number
}

export interface InkoopgroepDetail extends InkoopgroepRow {
  omschrijving: string | null
  created_at: string
  updated_at: string
}

export interface InkoopgroepLid {
  debiteur_nr: number
  naam: string
  plaats: string | null
  status: string
  tier: string | null
  logo_path: string | null
  vertegenw_code: string | null
}

export async function fetchInkoopgroepen(): Promise<InkoopgroepRow[]> {
  const { data, error } = await supabase
    .from('inkoopgroepen_met_aantal_leden')
    .select('code, naam, actief, aantal_leden')
    .order('code')
  if (error) throw error
  return (data ?? []) as InkoopgroepRow[]
}

export async function fetchInkoopgroepDetail(code: string): Promise<InkoopgroepDetail> {
  const { data, error } = await supabase
    .from('inkoopgroepen_met_aantal_leden')
    .select('*')
    .eq('code', code)
    .single()
  if (error) throw error
  return data as InkoopgroepDetail
}

export async function fetchInkoopgroepLeden(code: string): Promise<InkoopgroepLid[]> {
  const { data, error } = await supabase
    .from('debiteuren')
    .select('debiteur_nr, naam, plaats, status, tier, logo_path, vertegenw_code')
    .eq('inkoopgroep_code', code)
    .order('naam')
  if (error) throw error
  return (data ?? []) as InkoopgroepLid[]
}

/** Debiteuren die aan deze groep toegevoegd kunnen worden — alleen actieve. */
export async function fetchKoppelbareDebiteuren(): Promise<
  { debiteur_nr: number; naam: string; plaats: string | null; inkoopgroep_code: string | null }[]
> {
  const allRows: { debiteur_nr: number; naam: string; plaats: string | null; inkoopgroep_code: string | null }[] = []
  const pageSize = 1000
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('debiteuren')
      .select('debiteur_nr, naam, plaats, inkoopgroep_code')
      .eq('status', 'Actief')
      .order('naam')
      .range(from, from + pageSize - 1)
    if (error) throw error
    const batch = (data ?? []) as typeof allRows
    allRows.push(...batch)
    if (batch.length < pageSize) break
    from += pageSize
  }
  return allRows
}

export async function setDebiteurInkoopgroep(debiteurNr: number, code: string | null) {
  const { error } = await supabase
    .from('debiteuren')
    .update({ inkoopgroep_code: code })
    .eq('debiteur_nr', debiteurNr)
  if (error) throw error
}

/** Bulk-update: zet `inkoopgroep_code` op meerdere debiteuren tegelijk. */
export async function setDebiteurenInkoopgroep(debiteurNrs: number[], code: string | null) {
  if (debiteurNrs.length === 0) return
  const { error } = await supabase
    .from('debiteuren')
    .update({ inkoopgroep_code: code })
    .in('debiteur_nr', debiteurNrs)
  if (error) throw error
}

export interface InkoopgroepFormData {
  code: string
  naam: string
  omschrijving: string | null
  actief: boolean
}

export async function createInkoopgroep(data: InkoopgroepFormData) {
  const { error } = await supabase.from('inkoopgroepen').insert(data)
  if (error) throw error
}

export async function updateInkoopgroep(code: string, data: Omit<InkoopgroepFormData, 'code'>) {
  const { error } = await supabase
    .from('inkoopgroepen')
    .update(data)
    .eq('code', code)
  if (error) throw error
}

export async function deleteInkoopgroep(code: string) {
  // FK debiteuren.inkoopgroep_code heeft ON DELETE SET NULL — gekoppelde
  // debiteuren verliezen alleen hun groepsverwijzing, blijven bestaan.
  const { error } = await supabase.from('inkoopgroepen').delete().eq('code', code)
  if (error) throw error
}
