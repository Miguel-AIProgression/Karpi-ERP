// Ghost-besteld query voor de Voorraadpositie-Module.
//
// Achtergrond: de Module's batch-modus retourneert per design alléén paren met
// eigen voorraad (bestaans-regel uit mig 180). Voor het rollen-overzicht willen
// we óók ghost-paren tonen — (kwaliteit, kleur)-combinaties zonder voorraad maar
// mét openstaande inkooporders. Die merge gebeurt op page-niveau zodat het
// Module-concept zuiver blijft (Voorraadpositie = "iets dat bestaat").
//
// Deze query is een dunne wrapper rond RPC `besteld_per_kwaliteit_kleur` (mig
// 137) die de raw rows mapt naar een schoon `GhostBesteldRij`-shape. Door deze
// wrapper hoeft `rollen-overview.tsx` (en eventuele toekomstige callers) niet
// meer rechtstreeks de RPC aan te roepen — alle DB-calls voor de Voorraadpositie-
// data-flow zitten zo achter de Module-seam.
//
// Module-bestaans-regel onveranderd: de ghost-merge-logica zelf blijft op page-
// niveau, deze functie levert alleen de raw bron.

import { supabase } from '@/lib/supabase/client'
import { normaliseerKleurcode } from '../lib/normaliseer-kleur'

/** Eén ghost-besteld-rij — kwaliteit/kleur + besteld-aggregaten. */
export interface GhostBesteldRij {
  kwaliteit_code: string
  /** Genormaliseerd via `regexp_replace(/\.0+$/, '')` (zelfde regel als Module). */
  kleur_code: string
  besteld_m: number
  besteld_m2: number
  orders_count: number
  eerstvolgende_leverweek: string | null
  eerstvolgende_verwacht_datum: string | null
  eerstvolgende_m: number
  eerstvolgende_m2: number
}

interface RawRow {
  kwaliteit_code: string
  kleur_code: string
  besteld_m: number | string | null
  besteld_m2: number | string | null
  orders_count: number | string | null
  eerstvolgende_leverweek: string | null
  eerstvolgende_verwacht_datum: string | null
  eerstvolgende_m: number | string | null
  eerstvolgende_m2: number | string | null
}

function num(v: unknown): number {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Fetch besteld-aggregaten per (kwaliteit, kleur) — bron voor ghost-paren in
 * rollen-overzicht. Bij RPC-fout retourneert lege array en logt warning
 * (niet-fatale fallback: rollen-overzicht blijft zichtbaar zonder ghost-paren).
 */
export async function fetchGhostBesteldParen(): Promise<GhostBesteldRij[]> {
  // Cast: RPC staat nog niet in de generated types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('besteld_per_kwaliteit_kleur')
  if (error) {
    console.warn('besteld_per_kwaliteit_kleur RPC niet beschikbaar:', error.message)
    return []
  }
  const rows = (data ?? []) as RawRow[]
  return rows.map((row) => ({
    kwaliteit_code: row.kwaliteit_code,
    kleur_code: normaliseerKleurcode(row.kleur_code),
    besteld_m: num(row.besteld_m),
    besteld_m2: num(row.besteld_m2),
    orders_count: num(row.orders_count),
    eerstvolgende_leverweek: row.eerstvolgende_leverweek ?? null,
    eerstvolgende_verwacht_datum: row.eerstvolgende_verwacht_datum ?? null,
    eerstvolgende_m: num(row.eerstvolgende_m),
    eerstvolgende_m2: num(row.eerstvolgende_m2),
  }))
}
