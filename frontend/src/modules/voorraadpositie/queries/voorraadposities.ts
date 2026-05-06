// Query-laag voor de Voorraadpositie-Module.
//
// Single-paar-modus (T001, mig 179): roept RPC `voorraadposities` aan met beide
// (kw, kl) gevuld. Lege strings → null zonder Supabase-call (caller-niveau
// guard, voorkomt onnodige RT-trips).
//
// Batch+filter-modus (T003, mig 180): `fetchVoorraadposities(filter)` roept
// dezelfde RPC aan met optionele kw/kl/search. Lege filter → álle paren met
// eigen voorraad. SQL doet de filtering, dus client krijgt al een gefilterde
// dataset. Bestaans-regel: batch retourneert alléén paren met eigen voorraad
// (ghost-paren met enkel besteld zitten er niet in — caller mergt zelf).

import { supabase } from '@/lib/supabase/client'
import type { RolRow, RolStatus, RolType } from '@/lib/types/productie'
import type {
  BesteldInkoop,
  UitwisselbarePartner,
  Voorraadpositie,
  VoorraadpositieFilter,
} from '../types'
import { normaliseerKleurcode } from '../lib/normaliseer-kleur'

// Raw RPC-response-shape uit `voorraadposities()`. Numerieke kolommen kunnen
// als string terugkomen (NUMERIC) — we casten via Number() bij mapping.
interface VoorraadposityRpcRow {
  kwaliteit_code: string
  kleur_code: string
  product_naam: string | null
  eigen_volle_rollen: number | string | null
  eigen_aangebroken_rollen: number | string | null
  eigen_reststuk_rollen: number | string | null
  eigen_totaal_m2: number | string | null
  rollen: unknown // jsonb array of RolRow-shaped objecten
  partners: unknown // jsonb array of {kwaliteit_code, kleur_code, rollen, m2}
  beste_partner: unknown | null // jsonb of null
  besteld_m: number | string | null
  besteld_m2: number | string | null
  besteld_orders_count: number | string | null
  eerstvolgende_leverweek: string | null
  eerstvolgende_verwacht_datum: string | null
  eerstvolgende_m: number | string | null
  eerstvolgende_m2: number | string | null
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function toString(value: unknown): string {
  return typeof value === 'string' ? value : ''
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

function mapRol(raw: unknown): RolRow | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = toNumber(r.id)
  if (!id) return null
  return {
    id,
    rolnummer: toString(r.rolnummer),
    artikelnr: toString(r.artikelnr),
    kwaliteit_code: toString(r.kwaliteit_code),
    kleur_code: normaliseerKleurcode(toString(r.kleur_code)),
    lengte_cm: toNumber(r.lengte_cm),
    breedte_cm: toNumber(r.breedte_cm),
    oppervlak_m2: toNumber(r.oppervlak_m2),
    status: toString(r.status) as RolStatus,
    rol_type: toString(r.rol_type) as RolType,
    locatie: typeof r.locatie === 'string' ? r.locatie : null,
    oorsprong_rol_id:
      r.oorsprong_rol_id === null || r.oorsprong_rol_id === undefined
        ? null
        : toNumber(r.oorsprong_rol_id),
    reststuk_datum:
      typeof r.reststuk_datum === 'string' ? r.reststuk_datum : null,
  }
}

function mapRollen(raw: unknown): RolRow[] {
  if (!Array.isArray(raw)) return []
  const out: RolRow[] = []
  for (const item of raw) {
    const r = mapRol(item)
    if (r) out.push(r)
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
    eerstvolgende_m: toNumber(row.eerstvolgende_m),
    eerstvolgende_m2: toNumber(row.eerstvolgende_m2),
  }
}

function mapRow(row: VoorraadposityRpcRow): Voorraadpositie {
  return {
    kwaliteit_code: row.kwaliteit_code,
    kleur_code: normaliseerKleurcode(row.kleur_code),
    product_naam: row.product_naam ?? null,
    voorraad: {
      volle_rollen: toNumber(row.eigen_volle_rollen),
      aangebroken_rollen: toNumber(row.eigen_aangebroken_rollen),
      reststuk_rollen: toNumber(row.eigen_reststuk_rollen),
      totaal_m2: toNumber(row.eigen_totaal_m2),
    },
    rollen: mapRollen(row.rollen),
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

  // Cast: RPC staat nog niet in de generated types (mig 179/180 zijn HITL).
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

/**
 * Fetch álle Voorraadposities passend bij `filter`.
 *
 * Lege filter (alle velden undefined of leeg) → alle paren met eigen voorraad
 * (bestaans-regel afgedwongen op SQL-niveau in mig 180). Filter-velden gaan
 * 1-op-1 naar de RPC: kwaliteit (ILIKE-substring), kleur (exact na normalisatie),
 * search (ILIKE op `kw-kl` of producten.naam).
 *
 * Ghost-paren (geen eigen voorraad maar wel besteld) zitten NIET in de batch-
 * respons — callers die dat ook willen zien (rollen-overzicht) mergen zelf
 * via een aparte `besteld_per_kwaliteit_kleur`-call op page-niveau.
 */
export async function fetchVoorraadposities(
  filter: VoorraadpositieFilter,
): Promise<Voorraadpositie[]> {
  const p_kwaliteit = filter.kwaliteit && filter.kwaliteit.length > 0
    ? filter.kwaliteit
    : null
  const p_kleur = filter.kleur && filter.kleur.length > 0
    ? normaliseerKleurcode(filter.kleur)
    : null
  const p_search = filter.search && filter.search.length > 0
    ? filter.search
    : null

  // Cast: RPC staat nog niet in de generated types (mig 180 is HITL).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('voorraadposities', {
    p_kwaliteit,
    p_kleur,
    p_search,
  })

  if (error) {
    console.warn('voorraadposities (batch) RPC niet beschikbaar:', error.message)
    return []
  }

  const rows = (data ?? []) as VoorraadposityRpcRow[]
  return rows.map(mapRow)
}
