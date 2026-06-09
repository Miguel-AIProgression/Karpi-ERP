import { supabase } from '@/lib/supabase/client'

export interface HstMonitor {
  verstuurd_vandaag: number
  fout_open: number
  wachtrij: number
  bezig: number
  oudste_wachtrij_minuten: number
  oudste_bezig_minuten: number
}

export interface HstFoutRij {
  id: number
  zending_id: number
  zending_nr: string | null
  error_msg: string | null
  response_http_code: number | null
  retry_count: number
  updated_at: string
}

const CRON_STIL_DREMPEL_MIN = 5

export async function fetchHstMonitor(): Promise<HstMonitor> {
  const { data, error } = await supabase.from('hst_verzend_monitor').select('*').single()
  if (error) throw error
  return data as HstMonitor
}

/** True als de cron vermoedelijk stilstaat (oudste wachtrij/bezig boven drempel). */
export function cronVermoedelijkStil(m: HstMonitor): boolean {
  return m.oudste_wachtrij_minuten > CRON_STIL_DREMPEL_MIN || m.oudste_bezig_minuten > CRON_STIL_DREMPEL_MIN
}

/** Aantal items dat aandacht vraagt: open fouten + (cron stil ? 1). Eén bron-van-waarheid voor badge/banner. */
export function telHstAandacht(m: HstMonitor): number {
  return m.fout_open + (cronVermoedelijkStil(m) ? 1 : 0)
}

export async function fetchHstFouten(): Promise<HstFoutRij[]> {
  const { data, error } = await supabase
    .from('hst_transportorders')
    .select('id, zending_id, error_msg, response_http_code, retry_count, updated_at, zendingen(zending_nr)')
    .eq('status', 'Fout')
    .order('updated_at', { ascending: false })
    .limit(50)
  if (error) throw error
  // deno-lint-ignore no-explicit-any
  return (data ?? []).map((r: any) => ({
    id: r.id, zending_id: r.zending_id, zending_nr: r.zendingen?.zending_nr ?? null,
    error_msg: r.error_msg, response_http_code: r.response_http_code,
    retry_count: r.retry_count, updated_at: r.updated_at,
  }))
}

export async function countOrdersZonderVervoerder(): Promise<number> {
  const { count, error } = await supabase
    .from('orders_zonder_vervoerder')
    .select('order_id', { count: 'exact', head: true })
  if (error) throw error
  return count ?? 0
}
