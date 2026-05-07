import { supabase } from '../client'

export type MedewerkerRol = 'vertegenwoordiger' | 'picker'

export interface Medewerker {
  id: number
  naam: string
  code: string | null
  email: string | null
  telefoon: string | null
  actief: boolean
  rollen: MedewerkerRol[]
}

export interface PickerOption {
  id: number
  naam: string
}

/** Alle medewerkers, optioneel gefilterd op een rol. */
export async function fetchMedewerkers(rol?: MedewerkerRol): Promise<Medewerker[]> {
  let query = supabase
    .from('medewerkers')
    .select('id, naam, code, email, telefoon, actief, rollen')
    .order('naam')

  if (rol) {
    query = query.contains('rollen', [rol])
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Medewerker[]
}

/** Alleen actieve pickers, light-weight payload voor dropdown. */
export async function fetchPickers(): Promise<PickerOption[]> {
  const { data, error } = await supabase
    .from('medewerkers')
    .select('id, naam')
    .contains('rollen', ['picker'])
    .eq('actief', true)
    .order('naam')
  if (error) throw error
  return (data ?? []) as PickerOption[]
}

/** Maak nieuwe picker. Geen code. */
export async function createPicker(naam: string): Promise<Medewerker> {
  const { data, error } = await supabase
    .from('medewerkers')
    .insert({
      naam,
      rollen: ['picker'] satisfies MedewerkerRol[],
      actief: true,
    })
    .select('id, naam, code, email, telefoon, actief, rollen')
    .single()
  if (error) throw error
  return data as Medewerker
}

/** Update naam, contact, of actief. Niet rollen — daar is een aparte mutatie voor. */
export async function updateMedewerker(
  id: number,
  patch: Partial<Pick<Medewerker, 'naam' | 'email' | 'telefoon' | 'actief'>>,
): Promise<void> {
  const { error } = await supabase.from('medewerkers').update(patch).eq('id', id)
  if (error) throw error
}

/** Voeg een rol toe (bv. picker erbij voor een bestaande vertegenwoordiger). */
export async function addRolToMedewerker(id: number, rol: MedewerkerRol): Promise<void> {
  const { data, error: fetchErr } = await supabase
    .from('medewerkers')
    .select('rollen')
    .eq('id', id)
    .single()
  if (fetchErr) throw fetchErr

  const huidig = (data?.rollen ?? []) as MedewerkerRol[]
  if (huidig.includes(rol)) return

  const { error } = await supabase
    .from('medewerkers')
    .update({ rollen: [...huidig, rol] })
    .eq('id', id)
  if (error) throw error
}

/** Verwijder een rol. Medewerker blijft bestaan, ook als rollen leeg wordt. */
export async function removeRolVanMedewerker(id: number, rol: MedewerkerRol): Promise<void> {
  const { data, error: fetchErr } = await supabase
    .from('medewerkers')
    .select('rollen')
    .eq('id', id)
    .single()
  if (fetchErr) throw fetchErr

  const huidig = (data?.rollen ?? []) as MedewerkerRol[]
  const nieuw = huidig.filter((r) => r !== rol)

  const { error } = await supabase
    .from('medewerkers')
    .update({ rollen: nieuw })
    .eq('id', id)
  if (error) throw error
}
