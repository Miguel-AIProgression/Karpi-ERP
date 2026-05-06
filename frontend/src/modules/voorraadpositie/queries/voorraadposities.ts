// Query-laag voor de Voorraadpositie-Module.
//
// Single-paar-modus (T001): roept RPC `voorraadposities` aan met beide
// (kw, kl) gevuld. Lege strings → null zonder Supabase-call (caller-niveau
// guard, voorkomt onnodige RT-trips).
//
// T003 (#28) breidt uit met fetchVoorraadposities(filter) voor batch+filter.

import { supabase } from '@/lib/supabase/client'
import type {
  BesteldInkoop,
  UitwisselbarePartner,
  Voorraadpositie,
} from '../types'
import { normaliseerKleurcode } from '../lib/normaliseer-kleur'

// Raw RPC-response-shape uit `voorraadposities()`. Numerieke kolommen kunnen
// als string terugkomen (NUMERIC) — we casten via Number() bij mapping.
interface VoorraadposityRpcRow {
  kwaliteit_code: string
  kleur_code: string
  eigen_volle_rollen: number | string | null
  eigen_aangebroken_rollen: number | string | null
  eigen_reststuk_rollen: number | string | null
  eigen_totaal_m2: number | string | null
  partners: unknown // jsonb array of {kwaliteit_code, kleur_code, rollen, m2}
  beste_partner: unknown | null // jsonb of null
  besteld_m: number | string | null
  besteld_m2: number | string | null
  besteld_orders_count: number | string | null
  eerstvolgende_leverweek: string | null
  eerstvolgende_verwacht_datum: string | null
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function mapPartner(raw: unknown): UitwisselbarePartner | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const kw = typeof r.kwaliteit_code === 'string' ? r.kwaliteit_code : ''
  const kl = typeof r.kleur_code === 'string' ? r.kleur_code : ''
  if (!kw || !kl) return null
  return {
    kwaliteit_code: kw,
    kleur_code: normaliseerKleurcode(kl),
    rollen: toNumber(r.rollen),
    m2: toNumber(r.m2),
  }
}

function mapPartners(raw: unknown): UitwisselbarePartner[] {
  if (!Array.isArray(raw)) return []
  const out: UitwisselbarePartner[] = []
  for (const item of raw) {
    const p = mapPartner(item)
    if (p) out.push(p)
  }
  return out
}

function mapBesteld(row: VoorraadposityRpcRow): BesteldInkoop {
  return {
    besteld_m: toNumber(row.besteld_m),
    besteld_m2: toNumber(row.besteld_m2),
    orders_count: toNumber(row.besteld_orders_count),
    eerstvolgende_leverweek: row.eerstvolgende_leverweek ?? null,
    eerstvolgende_verwacht_datum: row.eerstvolgende_verwacht_datum ?? null,
  }
}

function mapRow(row: VoorraadposityRpcRow): Voorraadpositie {
  return {
    kwaliteit_code: row.kwaliteit_code,
    kleur_code: normaliseerKleurcode(row.kleur_code),
    voorraad: {
      volle_rollen: toNumber(row.eigen_volle_rollen),
      aangebroken_rollen: toNumber(row.eigen_aangebroken_rollen),
      reststuk_rollen: toNumber(row.eigen_reststuk_rollen),
      totaal_m2: toNumber(row.eigen_totaal_m2),
    },
    partners: mapPartners(row.partners),
    beste_partner: mapPartner(row.beste_partner),
    besteld: mapBesteld(row),
  }
}

/**
 * Fetch de Voorraadpositie voor één (kwaliteit_code, kleur_code)-paar.
 *
 * Lege strings voor kw of kl retourneren `null` zonder Supabase-call.
 * Geen rijen of een fout-respons retourneert eveneens `null` (caller
 * gebruikt loading/empty-state). Foutlogging in console voor debug.
 */
export async function fetchVoorraadpositie(
  kwaliteit_code: string,
  kleur_code: string,
): Promise<Voorraadpositie | null> {
  if (!kwaliteit_code || !kleur_code) return null

  // Cast: RPC staat nog niet in de generated types (mig 179 is HITL).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('voorraadposities', {
    p_kwaliteit: kwaliteit_code,
    p_kleur: normaliseerKleurcode(kleur_code),
    p_search: null,
  })

  if (error) {
    console.warn('voorraadposities RPC niet beschikbaar:', error.message)
    return null
  }

  const rows = (data ?? []) as VoorraadposityRpcRow[]
  if (rows.length === 0) return null

  return mapRow(rows[0])
}
