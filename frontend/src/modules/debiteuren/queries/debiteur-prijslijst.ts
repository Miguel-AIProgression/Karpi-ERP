// Klant-bound prijslijst-koppeling. Pragma: leeft hier tot een eigen
// Prijslijst-Module ADR komt — zie ADR-0011 (open kandidaten op de backlog).
import { supabase } from '@/lib/supabase/client'

export interface PrijslijstRegel {
  artikelnr: string
  omschrijving: string | null
  omschrijving_2: string | null
  prijs: number
  gewicht: number | null
}

export async function fetchPrijslijstHeadersList() {
  const { data, error } = await supabase
    .from('prijslijst_headers')
    .select('nr, naam, actief')
    .order('nr')
  if (error) throw error
  return (data ?? []) as { nr: string; naam: string; actief: boolean }[]
}

export async function setKlantPrijslijst(debiteurNr: number, prijslijstNr: string | null) {
  const { error } = await supabase
    .from('debiteuren')
    .update({ prijslijst_nr: prijslijstNr })
    .eq('debiteur_nr', debiteurNr)
  if (error) throw error
}

export async function setKlantenPrijslijst(debiteurNrs: number[], prijslijstNr: string | null) {
  if (debiteurNrs.length === 0) return
  const { error } = await supabase
    .from('debiteuren')
    .update({ prijslijst_nr: prijslijstNr })
    .in('debiteur_nr', debiteurNrs)
  if (error) throw error
}

export async function fetchKlantPrijslijst(debiteurNr: number): Promise<PrijslijstRegel[]> {
  const { data: klant, error: klantError } = await supabase
    .from('debiteuren')
    .select('prijslijst_nr')
    .eq('debiteur_nr', debiteurNr)
    .single()

  if (klantError) throw klantError
  if (!klant?.prijslijst_nr) return []

  const allRows: PrijslijstRegel[] = []
  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('prijslijst_regels')
      .select('artikelnr, omschrijving, omschrijving_2, prijs, gewicht')
      .eq('prijslijst_nr', klant.prijslijst_nr)
      .order('artikelnr')
      .range(offset, offset + pageSize - 1)

    if (error) throw error
    allRows.push(...((data ?? []) as PrijslijstRegel[]))
    if (!data || data.length < pageSize) break
    offset += pageSize
  }
  return allRows
}
