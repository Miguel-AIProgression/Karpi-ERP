import { supabase } from '../client'

const CONFIG_KEY = 'order_config'

export interface OrderConfig {
  standaard_maat_werkdagen: number
  maatwerk_weken: number
}

const DEFAULT_CONFIG: OrderConfig = {
  standaard_maat_werkdagen: 5,
  maatwerk_weken: 4,
}

export async function fetchOrderConfig(): Promise<OrderConfig> {
  const { data, error } = await supabase
    .from('app_config')
    .select('waarde')
    .eq('sleutel', CONFIG_KEY)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return DEFAULT_CONFIG
    throw error
  }

  return { ...DEFAULT_CONFIG, ...(data.waarde as Partial<OrderConfig>) }
}

export async function updateOrderConfig(config: OrderConfig): Promise<void> {
  const { error } = await supabase
    .from('app_config')
    .upsert(
      { sleutel: CONFIG_KEY, waarde: config as unknown as Record<string, unknown> },
      { onConflict: 'sleutel' }
    )

  if (error) throw error
}
