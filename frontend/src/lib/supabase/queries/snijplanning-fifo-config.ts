import { supabase } from '../client'

// FIFO-magazijnleeftijd-criteria (ADR-0021). Los app_config-record zodat de
// snijplanner-packer ze online uitleest zonder code-deploy. Spiegelt mig 283.

const CONFIG_KEY = 'snijplanning'

export type FifoModus = 'simpel' | 'geavanceerd'

export interface SnijplanningFifoConfig {
  /** 'simpel' = strikt oudste-rol-eerst (huidig live-gedrag, geparkeerd).
   *  'geavanceerd' = volledige kost-afweging + badge + carve-out. */
  modus: FifoModus
  drempel_dagen: number
  harde_bovengrens_dagen: number
  alpha: number
  badge_geel_m2: number
  badge_geel_pct: number
  badge_rood_m2: number
  badge_rood_pct: number
}

export const DEFAULT_FIFO_CONFIG: SnijplanningFifoConfig = {
  modus: 'simpel',
  drempel_dagen: 90,
  harde_bovengrens_dagen: 180,
  alpha: 0.05,
  badge_geel_m2: 5,
  badge_geel_pct: 25,
  badge_rood_m2: 10,
  badge_rood_pct: 50,
}

export async function fetchSnijplanningFifoConfig(): Promise<SnijplanningFifoConfig> {
  const { data, error } = await supabase
    .from('app_config')
    .select('waarde')
    .eq('sleutel', CONFIG_KEY)
    .maybeSingle()

  if (error) throw error
  return { ...DEFAULT_FIFO_CONFIG, ...((data?.waarde as Partial<SnijplanningFifoConfig>) ?? {}) }
}

/** Read-modify-write: behoud eventuele andere sleutels onder 'snijplanning'. */
export async function updateSnijplanningFifoConfig(
  config: SnijplanningFifoConfig,
): Promise<void> {
  const { data: huidig } = await supabase
    .from('app_config')
    .select('waarde')
    .eq('sleutel', CONFIG_KEY)
    .maybeSingle()

  const samengevoegd = {
    ...((huidig?.waarde as Record<string, unknown>) ?? {}),
    ...config,
  }

  const { error } = await supabase
    .from('app_config')
    .upsert({ sleutel: CONFIG_KEY, waarde: samengevoegd }, { onConflict: 'sleutel' })

  if (error) throw error
}
