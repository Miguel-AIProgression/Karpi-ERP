// Shared database helpers for snijplanning edge functions
// Used by: optimaliseer-snijplan, auto-plan-groep

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { SnijplanPiece, Roll } from './ffdh-packing.ts'

// ---------------------------------------------------------------------------
// Fetch snijplannen from the view
// ---------------------------------------------------------------------------

export interface FetchStukkenOptions {
  kwaliteitCode: string
  kleurCode: string
  statuses?: string[]  // default: ['Wacht']
  totDatum?: string | null
}

export async function fetchStukken(
  supabase: SupabaseClient,
  options: FetchStukkenOptions,
): Promise<SnijplanPiece[]> {
  const { kwaliteitCode, kleurCode, totDatum } = options
  const statuses = options.statuses ?? ['Wacht']

  const kleurVariants = getKleurVariants(kleurCode)

  let query = supabase
    .from('snijplanning_overzicht')
    .select(
      'id, snij_lengte_cm, snij_breedte_cm, maatwerk_vorm, order_nr, klant_naam, afleverdatum',
    )
    .in('status', statuses)
    .is('rol_id', null)
    .eq('kwaliteit_code', kwaliteitCode)
    .in('kleur_code', kleurVariants)

  if (totDatum) {
    query = query.or(`afleverdatum.lte.${totDatum},afleverdatum.is.null`)
  }

  const { data, error } = await query
  if (error) throw error

  return (data ?? []).map((sp: Record<string, unknown>) => ({
    id: sp.id as number,
    lengte_cm: sp.snij_lengte_cm as number,
    breedte_cm: sp.snij_breedte_cm as number,
    maatwerk_vorm: sp.maatwerk_vorm as string | null,
    order_nr: sp.order_nr as string | null,
    klant_naam: sp.klant_naam as string | null,
    afleverdatum: sp.afleverdatum as string | null,
    area_cm2: (sp.snij_lengte_cm as number) * (sp.snij_breedte_cm as number),
  }))
}

// ---------------------------------------------------------------------------
// Fetch available rolls (with interchangeable kwaliteiten + kleur variants)
// ---------------------------------------------------------------------------

export async function fetchUitwisselbareCodes(
  supabase: SupabaseClient,
  kwaliteitCode: string,
): Promise<string[]> {
  const { data: kwaliteit } = await supabase
    .from('kwaliteiten')
    .select('code, collectie_id')
    .eq('code', kwaliteitCode)
    .maybeSingle()

  let codes = [kwaliteitCode]
  if (kwaliteit?.collectie_id) {
    const { data: verwant } = await supabase
      .from('kwaliteiten')
      .select('code')
      .eq('collectie_id', kwaliteit.collectie_id)
    if (verwant) {
      codes = verwant.map((k: { code: string }) => k.code)
    }
  }
  return codes
}

export function getKleurVariants(kleurCode: string): string[] {
  const variants = [kleurCode]
  if (!kleurCode.includes('.')) variants.push(`${kleurCode}.0`)
  if (kleurCode.endsWith('.0')) variants.push(kleurCode.replace('.0', ''))
  return variants
}

export async function fetchBeschikbareRollen(
  supabase: SupabaseClient,
  uitwisselbareCodes: string[],
  kleurVariants: string[],
  kwaliteitCode: string,
): Promise<Roll[]> {
  const { data: rollen, error } = await supabase
    .from('rollen')
    .select('id, rolnummer, lengte_cm, breedte_cm, status, oppervlak_m2, kwaliteit_code')
    .in('kwaliteit_code', uitwisselbareCodes)
    .in('kleur_code', kleurVariants)
    .in('status', ['beschikbaar', 'reststuk'])

  if (error) throw error

  return (rollen ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as number,
    rolnummer: r.rolnummer as string,
    lengte_cm: r.lengte_cm as number,
    breedte_cm: r.breedte_cm as number,
    status: r.status as string,
    oppervlak_m2: r.oppervlak_m2 as number,
    sort_priority: (r.status as string) === 'reststuk' ? 1 : 2,
    is_exact: (r.kwaliteit_code as string) === kwaliteitCode,
  }))
}

// ---------------------------------------------------------------------------
// Save voorstel + plaatsingen to database
// ---------------------------------------------------------------------------

export interface SaveVoorstelOptions {
  kwaliteitCode: string
  kleurCode: string
  totaalStukken: number
  totaalRollen: number
  totaalM2Gebruikt: number
  totaalM2Afval: number
  afvalPercentage: number
  aangemaakt_door?: string
}

export async function saveVoorstel(
  supabase: SupabaseClient,
  options: SaveVoorstelOptions,
  plaatsingen: Array<{
    rol_id: number
    snijplan_id: number
    positie_x_cm: number
    positie_y_cm: number
    lengte_cm: number
    breedte_cm: number
    geroteerd: boolean
  }>,
): Promise<{ voorstel_id: number; voorstel_nr: string }> {
  // Get next voorstel number
  const { data: nrData, error: nrError } = await supabase.rpc(
    'volgend_nummer',
    { p_type: 'SNIJV' },
  )
  if (nrError) throw nrError
  const voorstel_nr = nrData as string

  // Insert voorstel
  const { data: voorstel, error: vsError } = await supabase
    .from('snijvoorstellen')
    .insert({
      voorstel_nr,
      kwaliteit_code: options.kwaliteitCode,
      kleur_code: options.kleurCode,
      totaal_stukken: options.totaalStukken,
      totaal_rollen: options.totaalRollen,
      totaal_m2_gebruikt: Math.round(options.totaalM2Gebruikt * 100) / 100,
      totaal_m2_afval: Math.round(options.totaalM2Afval * 100) / 100,
      afval_percentage: options.afvalPercentage,
      status: 'concept',
      ...(options.aangemaakt_door ? { aangemaakt_door: options.aangemaakt_door } : {}),
    })
    .select('id')
    .single()

  if (vsError) throw vsError
  const voorstel_id = voorstel.id

  // Insert plaatsingen
  if (plaatsingen.length > 0) {
    const { error: plError } = await supabase
      .from('snijvoorstel_plaatsingen')
      .insert(plaatsingen.map(p => ({ voorstel_id, ...p })))

    if (plError) throw plError
  }

  return { voorstel_id, voorstel_nr }
}
