import { supabase } from '../client'

export interface AutoPlanningConfig {
  enabled: boolean
  horizon_weken: number
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
    return { enabled: false, horizon_weken: 2 }
  }

  const val = data.waarde as Record<string, unknown>
  return {
    enabled: (val.enabled as boolean) ?? false,
    horizon_weken: (val.horizon_weken as number) ?? 2,
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

/** Trigger auto-plan for a specific kwaliteit/kleur group */
export async function triggerAutoplan(
  kwaliteitCode: string,
  kleurCode: string,
  totDatum?: string | null,
): Promise<{ success?: boolean; skipped?: boolean; reason?: string }> {
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
      if (ctx instanceof Response) {
        const body = await ctx.json()
        if (body?.error) msg = body.error
      }
    } catch { /* fallback */ }
    throw new Error(msg)
  }

  return data as { success?: boolean; skipped?: boolean; reason?: string }
}

/** Start productie for a specific roll via RPC */
export async function startProductieRol(rolId: number): Promise<number> {
  const { data, error } = await supabase.rpc('start_productie_rol', {
    p_rol_id: rolId,
  })
  if (error) throw error
  return data as number
}
