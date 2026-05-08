// frontend/src/modules/maatwerk/queries/maatwerk-instellingen.ts
//
// Admin-CRUD-mutaties voor de Maatwerk-Module. Reads die door de runtime-flow
// worden gebruikt staan in `./maatwerk-runtime.ts` (Task 4). Zie ADR-0009.

import { supabase } from '@/lib/supabase/client'
import type { MaatwerkVormRow, AfwerkingTypeRow } from './maatwerk-runtime'

export async function fetchAlleVormen(): Promise<MaatwerkVormRow[]> {
  const { data, error } = await supabase
    .from('maatwerk_vormen')
    .select('*')
    .order('volgorde')
  if (error) throw error
  return data ?? []
}

export async function upsertVorm(vorm: Omit<MaatwerkVormRow, 'id'> & { id?: number }) {
  const { id, ...payload } = vorm
  if (id) {
    const { error } = await supabase.from('maatwerk_vormen').update(payload).eq('id', id)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase.from('maatwerk_vormen').insert(payload)
    if (error) throw new Error(error.message)
  }
}

export async function deleteVorm(id: number) {
  const { error } = await supabase.from('maatwerk_vormen').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function fetchAlleAfwerkingTypes(): Promise<AfwerkingTypeRow[]> {
  const { data, error } = await supabase
    .from('afwerking_types')
    .select('*')
    .order('volgorde')
  if (error) throw error
  return data ?? []
}

export async function upsertAfwerkingType(at: Omit<AfwerkingTypeRow, 'id'> & { id?: number }) {
  const { id, ...payload } = at
  if (id) {
    const { error } = await supabase.from('afwerking_types').update(payload).eq('id', id)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase.from('afwerking_types').insert(payload)
    if (error) throw new Error(error.message)
  }
}

export async function deleteAfwerkingType(id: number) {
  const { error } = await supabase.from('afwerking_types').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function setStandaardAfwerking(kwaliteitCode: string, afwerkingCode: string) {
  const { error } = await supabase
    .from('kwaliteit_standaard_afwerking')
    .upsert({ kwaliteit_code: kwaliteitCode, afwerking_code: afwerkingCode })
  if (error) throw error
}

/** Per kwaliteit+kleur afwerking opslaan (overschrijft kwaliteit-default). */
export async function setAfwerkingVoorKleur(
  kwaliteitCode: string,
  kleurCode: string,
  afwerkingCode: string,
) {
  const { error } = await supabase
    .from('maatwerk_afwerking_per_kleur')
    .upsert({
      kwaliteit_code: kwaliteitCode,
      kleur_code: kleurCode,
      afwerking_code: afwerkingCode,
    })
  if (error) throw error
}

export async function clearStandaardAfwerking(kwaliteitCode: string): Promise<void> {
  const { error } = await supabase
    .from('kwaliteit_standaard_afwerking')
    .delete()
    .eq('kwaliteit_code', kwaliteitCode)
  if (error) throw new Error(error.message)
}

/** Default-bandkleur zetten of leegmaken voor (kwaliteit, kleur).
 *  Gebruikt UPDATE-then-INSERT (geen upsert) zodat bestaande legacy-velden
 *  intact blijven als de rij al bestaat. */
export async function setBandKleurDefault(
  kwaliteitCode: string,
  kleurCode: string,
  afwerkingKleurId: number | null,
): Promise<void> {
  // 1) Probeer UPDATE — werkt als rij al bestaat (de meest voorkomende case voor Piero-rijen).
  const { data: updated, error: upErr } = await supabase
    .from('maatwerk_band_defaults')
    .update({ afwerking_kleur_id: afwerkingKleurId })
    .eq('kwaliteit_code', kwaliteitCode)
    .eq('kleur_code', kleurCode)
    .select('kwaliteit_code')
  if (upErr) throw new Error(upErr.message)
  if ((updated?.length ?? 0) > 0) return

  // 2) Geen bestaande rij — INSERT met label-snapshot zodat legacy band_kleur niet leeg blijft.
  if (afwerkingKleurId === null) {
    return // niets opslaan; geen FK + geen legacy = geen rij nodig
  }
  const { data: kleurRow, error: lookupErr } = await supabase
    .from('afwerking_kleuren')
    .select('label')
    .eq('id', afwerkingKleurId)
    .maybeSingle()
  if (lookupErr) throw new Error(lookupErr.message)
  const labelSnapshot = kleurRow?.label ?? ''

  const { error: insErr } = await supabase
    .from('maatwerk_band_defaults')
    .insert({
      kwaliteit_code: kwaliteitCode,
      kleur_code: kleurCode,
      afwerking_kleur_id: afwerkingKleurId,
      band_kleur: labelSnapshot,
    })
  if (insErr) throw new Error(insErr.message)
}
