// Query-laag voor de "open maatwerk-orders die druk veroorzaken"-tak van de
// Voorraadpositie-Module.
//
// Bron: SQL-RPC `open_maatwerkvraag_orders(p_kwaliteit, p_kleur)` (mig 299).
// Familie-scoped: filtert intern via `uitwisselbare_paren(kw, kl)` zodat alle
// snijplannen onder druk (bestelde kw/kl kan elke alias in de familie zijn)
// worden teruggegeven. Bedoeld om lazy gefetcht te worden vanuit de Rollen &
// Reststukken-expand wanneer `bruto_maatwerkvraag_m2 > 0` op de familie.
//
// ADR-0026 — zelfde formule als mig 296 voor bruto_m2.

import { supabase } from '@/lib/supabase/client'
import { normaliseerKleurcode } from '../lib/normaliseer-kleur'

export interface OpenMaatwerkvraagOrder {
  snijplan_id: number
  snijplan_nr: string
  /** Snijplan-status — alleen 'Wacht' | 'Gepland' | 'Snijden' komt terug. */
  status: string
  snij_lengte_cm: number
  snij_breedte_cm: number
  /** Bijdrage aan bruto-maatwerkvraag voor dit ene stuk (m²). */
  bruto_m2: number
  /** Bestelde kwaliteit — kan een partner-alias zijn binnen de familie. */
  besteld_kwaliteit_code: string
  /** Bestelde kleur — genormaliseerd ('.0'-suffix gestript). */
  besteld_kleur_code: string
  order_id: number
  order_nr: string
  /** ISO-datum of null. */
  afleverdatum: string | null
  debiteur_nr: number
  klant_naam: string
}

interface RpcRow {
  snijplan_id: number | string
  snijplan_nr: string
  status: string
  snij_lengte_cm: number | string
  snij_breedte_cm: number | string
  bruto_m2: number | string | null
  besteld_kwaliteit_code: string
  besteld_kleur_code: string
  order_id: number | string
  order_nr: string
  afleverdatum: string | null
  debiteur_nr: number | string
  klant_naam: string | null
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function mapRow(row: RpcRow): OpenMaatwerkvraagOrder {
  return {
    snijplan_id: toNumber(row.snijplan_id),
    snijplan_nr: row.snijplan_nr,
    status: row.status,
    snij_lengte_cm: toNumber(row.snij_lengte_cm),
    snij_breedte_cm: toNumber(row.snij_breedte_cm),
    bruto_m2: toNumber(row.bruto_m2),
    besteld_kwaliteit_code: row.besteld_kwaliteit_code,
    besteld_kleur_code: normaliseerKleurcode(row.besteld_kleur_code),
    order_id: toNumber(row.order_id),
    order_nr: row.order_nr,
    afleverdatum: row.afleverdatum,
    debiteur_nr: toNumber(row.debiteur_nr),
    klant_naam: row.klant_naam ?? '',
  }
}

export async function fetchOpenMaatwerkvraagOrders(
  kwaliteit_code: string,
  kleur_code: string,
): Promise<OpenMaatwerkvraagOrder[]> {
  if (!kwaliteit_code || !kleur_code) return []
  // Cast: RPC staat nog niet in de generated types (mig 299 is HITL).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('open_maatwerkvraag_orders', {
    p_kwaliteit: kwaliteit_code,
    p_kleur: normaliseerKleurcode(kleur_code),
  })

  if (error) {
    console.warn('open_maatwerkvraag_orders RPC niet beschikbaar:', error.message)
    return []
  }

  const rows = (data ?? []) as RpcRow[]
  return rows.map(mapRow)
}
