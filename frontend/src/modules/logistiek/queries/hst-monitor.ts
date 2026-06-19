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
  extern_referentie: string | null
  retry_count: number
  updated_at: string
}

const CRON_STIL_DREMPEL_MIN = 5

const LEGE_MONITOR: HstMonitor = {
  verstuurd_vandaag: 0,
  fout_open: 0,
  wachtrij: 0,
  bezig: 0,
  oudste_wachtrij_minuten: 0,
  oudste_bezig_minuten: 0,
}

export async function fetchHstMonitor(): Promise<HstMonitor> {
  // Mig 424 (ADR-0038): één geconsolideerde view `verzend_monitor` met één rij
  // per vervoerder_code. Geen rij voor 'hst_api' = geen actieve/recente rijen
  // → behandel als alle-nullen (zelfde shape).
  const { data, error } = await supabase
    .from('verzend_monitor')
    .select('verstuurd_vandaag, fout_open, wachtrij, bezig, oudste_wachtrij_minuten, oudste_bezig_minuten')
    .eq('vervoerder_code', 'hst_api')
    .maybeSingle()
  if (error) throw error
  if (!data) return { ...LEGE_MONITOR }
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
  // Mig 424 (ADR-0038): één geconsolideerde `verzend_wachtrij`-tabel,
  // gediscrimineerd op vervoerder_code.
  const { data, error } = await supabase
    .from('verzend_wachtrij')
    .select('id, zending_id, error_msg, retry_count, updated_at, extern_referentie, zendingen ( zending_nr )')
    .eq('vervoerder_code', 'hst_api')
    .eq('status', 'Fout')
    .order('updated_at', { ascending: false })
    .limit(50)
  if (error) throw error
  // deno-lint-ignore no-explicit-any
  return (data ?? []).map((r: any) => ({
    id: r.id, zending_id: r.zending_id, zending_nr: r.zendingen?.zending_nr ?? null,
    error_msg: r.error_msg, extern_referentie: r.extern_referentie,
    retry_count: r.retry_count, updated_at: r.updated_at,
  }))
}

interface ZonderVervoerderRij {
  order_id: number
  afl_land: string | null
  /** Sinds mig 372; ontbreekt zolang die migratie nog niet is toegepast. */
  afl_land_norm?: string | null
  status?: string | null
}

export interface ZonderVervoerderSamenvatting {
  totaal: number
  /** Per genormaliseerd land, aflopend gesorteerd op aantal. */
  perLand: Array<{ land: string; aantal: number }>
  /** null zolang de view nog geen status-kolom heeft (mig 372 niet toegepast). */
  klaarVoorPicken: number | null
}

/** Pure aggregatie, los van de fetch zodat hij testbaar is en tolerant voor een pre-mig-372 view. */
export function vatZonderVervoerderSamen(rows: ZonderVervoerderRij[]): ZonderVervoerderSamenvatting {
  const perLandMap = new Map<string, number>()
  for (const r of rows) {
    const land = r.afl_land_norm ?? (r.afl_land ?? '').trim().toUpperCase() ?? ''
    const key = land || 'Onbekend'
    perLandMap.set(key, (perLandMap.get(key) ?? 0) + 1)
  }
  const heeftStatus = rows.length > 0 && rows[0].status !== undefined
  return {
    totaal: rows.length,
    perLand: [...perLandMap.entries()]
      .map(([land, aantal]) => ({ land, aantal }))
      .sort((a, b) => b.aantal - a.aantal),
    klaarVoorPicken: heeftStatus ? rows.filter((r) => r.status === 'Klaar voor picken').length : null,
  }
}

export async function fetchOrdersZonderVervoerder(): Promise<ZonderVervoerderSamenvatting> {
  // select('*') i.p.v. expliciete kolommen: blijft werken op de pre-mig-372 view.
  const { data, error } = await supabase.from('orders_zonder_vervoerder').select('*').limit(2000)
  if (error) throw error
  return vatZonderVervoerderSamen((data ?? []) as ZonderVervoerderRij[])
}
