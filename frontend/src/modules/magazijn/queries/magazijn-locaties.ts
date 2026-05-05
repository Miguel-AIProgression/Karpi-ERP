import { supabase } from '@/lib/supabase/client'

export interface MagazijnLocatie {
  id: number
  code: string
  omschrijving: string | null
  type: string
  actief: boolean
}

export async function fetchMagazijnLocaties(): Promise<MagazijnLocatie[]> {
  const { data, error } = await supabase
    .from('magazijn_locaties')
    .select('id, code, omschrijving, type, actief')
    .eq('actief', true)
    .order('code', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as MagazijnLocatie[]
}

export async function createOrGetMagazijnLocatie(code: string): Promise<number> {
  const { data, error } = await supabase.rpc('create_or_get_magazijn_locatie', {
    p_code: code,
  })
  if (error) throw error
  return data as number
}
