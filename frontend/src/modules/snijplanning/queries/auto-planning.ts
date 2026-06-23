import { supabase } from '@/lib/supabase/client'
import type { VerdrongenOrder } from './snijvoorstel'

export interface AutoPlanningConfig {
  enabled: boolean
}

/** Fetch auto-planning configuration from app_config */
export async function fetchAutoplanningConfig(): Promise<AutoPlanningConfig> {
  const { data, error } = await supabase
    .from('app_config')
    .select('waarde')
    .eq('sleutel', 'snijplanning.auto_planning')
    .maybeSingle()

  if (error) throw error

  if (!data) {
    return { enabled: false }
  }

  const val = data.waarde as Record<string, unknown>
  return {
    enabled: (val.enabled as boolean) ?? false,
  }
}

/** Update auto-planning configuration */
export async function updateAutoplanningConfig(config: AutoPlanningConfig): Promise<void> {
  const { error } = await supabase
    .from('app_config')
    .upsert(
      { sleutel: 'snijplanning.auto_planning', waarde: config as unknown as Record<string, unknown> },
      { onConflict: 'sleutel' },
    )

  if (error) throw error
}

/** Volledige respons van edge function `auto-plan-groep` — eerder slechts
 *  deels getypeerd, waardoor `auto_approved`/`reason`/`verdrongen_orders` in
 *  de UI onopgemerkt bleven (de aanroeper zag alleen "geen fout", niet "wel
 *  een concept dat handmatige beoordeling nodig heeft"). */
export interface AutoplanGroepResultaat {
  success?: boolean
  skipped?: boolean
  reason?: string
  voorstel_id?: number
  voorstel_nr?: string
  released?: number
  /** FALSE = voorstel blijft concept (handmatige beoordeling nodig) — succes
   *  betekent hier dus niet automatisch "is nu live ingepland". */
  auto_approved?: boolean
  /** Zelfde shape als de Fase 2-verdringingscheck (`./snijvoorstel`). */
  verdrongen_orders?: VerdrongenOrder[]
  samenvatting?: {
    totaal_stukken: number
    geplaatst: number
    niet_geplaatst: number
    totaal_rollen: number
    gemiddeld_afval_pct: number
  }
}

/** Trigger auto-plan for a specific kwaliteit/kleur group */
export async function triggerAutoplan(
  kwaliteitCode: string,
  kleurCode: string,
  totDatum?: string | null,
): Promise<AutoplanGroepResultaat> {
  const body: Record<string, string> = {
    kwaliteit_code: kwaliteitCode,
    kleur_code: kleurCode,
  }
  if (totDatum) body.tot_datum = totDatum

  const { data, error } = await supabase.functions.invoke('auto-plan-groep', { body })

  if (error) {
    let msg = error.message
    try {
      const ctx = (error as Record<string, unknown>).context
      const resp = ctx as Response
      if (resp?.json) {
        const parsed = await resp.json()
        if (parsed?.error) msg = parsed.error
        else msg = JSON.stringify(parsed)
      }
    } catch { /* fallback */ }
    throw new Error(msg)
  }

  return data as AutoplanGroepResultaat
}

export interface BenodigdeLengteSchatting {
  kan_berekenen: boolean
  reden?: string
  benodigde_lengte_cm?: number
  benodigde_m2?: number
  standaard_breedte_cm?: number
  afval_percentage?: number
  aantal_stukken?: number
  aantal_niet_passend?: number
}

/** Puur lezende schatting: hoeveel rol-lengte is nodig om de huidige
 *  Tekort-stukken (rol_id IS NULL) van deze kwaliteit+kleur te snijden op een
 *  nieuwe rol van de standaardbreedte — via de echte guillotine-packer, niet
 *  een platte m²-som. Geen schrijfacties (zie schat-benodigde-lengte). */
export async function fetchBenodigdeLengteSchatting(
  kwaliteitCode: string,
  kleurCode: string,
): Promise<BenodigdeLengteSchatting> {
  const { data, error } = await supabase.functions.invoke('schat-benodigde-lengte', {
    body: { kwaliteit_code: kwaliteitCode, kleur_code: kleurCode },
  })

  if (error) {
    let msg = error.message
    try {
      const ctx = (error as Record<string, unknown>).context
      const resp = ctx as Response
      if (resp?.json) {
        const parsed = await resp.json()
        if (parsed?.error) msg = parsed.error
        else msg = JSON.stringify(parsed)
      }
    } catch { /* fallback */ }
    throw new Error(msg)
  }

  return data as BenodigdeLengteSchatting
}

/** Start productie for a specific roll via RPC */
export async function startProductieRol(rolId: number): Promise<number> {
  const { data, error } = await supabase.rpc('start_productie_rol', {
    p_rol_id: rolId,
  })
  if (error) throw error
  return data as number
}
