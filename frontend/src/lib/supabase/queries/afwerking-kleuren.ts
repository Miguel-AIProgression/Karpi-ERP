import { supabase } from '../client'

export interface AfwerkingKleurRow {
  id: number
  afwerking_code: string
  label: string
  volgorde: number
  actief: boolean
}

export async function fetchAfwerkingKleuren(afwerkingCode: string): Promise<AfwerkingKleurRow[]> {
  const { data, error } = await supabase
    .from('afwerking_kleuren')
    .select('*')
    .eq('afwerking_code', afwerkingCode)
    .order('volgorde')
    .order('label')
  if (error) throw error
  return data ?? []
}

export async function fetchActieveAfwerkingKleuren(afwerkingCode: string): Promise<AfwerkingKleurRow[]> {
  const { data, error } = await supabase
    .from('afwerking_kleuren')
    .select('*')
    .eq('afwerking_code', afwerkingCode)
    .eq('actief', true)
    .order('volgorde')
    .order('label')
  if (error) throw error
  return data ?? []
}

export async function fetchAlleAfwerkingKleurenById(): Promise<Map<number, AfwerkingKleurRow>> {
  const { data, error } = await supabase.from('afwerking_kleuren').select('*')
  if (error) throw error
  return new Map((data ?? []).map((r) => [r.id, r as AfwerkingKleurRow]))
}

export async function upsertAfwerkingKleur(
  row: Omit<AfwerkingKleurRow, 'id'> & { id?: number },
): Promise<AfwerkingKleurRow> {
  const { id, ...payload } = row
  if (id) {
    const { data, error } = await supabase
      .from('afwerking_kleuren')
      .update(payload)
      .eq('id', id)
      .select()
      .single()
    if (error) throw new Error(error.message)
    return data as AfwerkingKleurRow
  }
  const { data, error } = await supabase
    .from('afwerking_kleuren')
    .insert(payload)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as AfwerkingKleurRow
}

export async function deleteAfwerkingKleur(id: number): Promise<void> {
  const { error } = await supabase.from('afwerking_kleuren').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
