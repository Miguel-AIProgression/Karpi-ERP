import { supabase } from '../client'
import type { PlanningConfig } from '@/lib/types/productie'

const CONFIG_KEY = 'productie_planning'

const DEFAULT_CONFIG: PlanningConfig = {
  planning_modus: 'weken',
  capaciteit_per_week: 450,
  capaciteit_marge_pct: 10,
  weken_vooruit: 4,
  max_reststuk_verspilling_pct: 15,
}

/** Fetch planning config from app_config */
export async function fetchPlanningConfig(): Promise<PlanningConfig> {
  const { data, error } = await supabase
    .from('app_config')
    .select('waarde')
    .eq('sleutel', CONFIG_KEY)
    .single()

  if (error) {
    // If no row exists yet, return defaults
    if (error.code === 'PGRST116') return DEFAULT_CONFIG
    throw error
  }

  return { ...DEFAULT_CONFIG, ...(data.waarde as Partial<PlanningConfig>) }
}

/** Update planning config in app_config */
export async function updatePlanningConfig(config: PlanningConfig): Promise<void> {
  const { error } = await supabase
    .from('app_config')
    .upsert(
      { sleutel: CONFIG_KEY, waarde: config as unknown as Record<string, unknown> },
      { onConflict: 'sleutel' }
    )

  if (error) throw error
}
