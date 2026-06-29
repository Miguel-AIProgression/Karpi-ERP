// Fase (c) — handmatige IO-koppeling vanuit de werklijst-pagina.
//
// Queries voor het ophalen van open IO-regels (kandidaten voor koppeling) en
// mutations voor koppelen/ontkoppelen van een snijplan-stuk.
//
// Conservatieve bijdrage-schatting: de RPC gebruikt placed_breedte_cm
// (= breedte_cm + stuk_snij_marge_cm) als bijdrage per stuk.
// MARGE-2.5CM: marge voor rond/ovaal = 2.5 cm (mig 464 stuk_snij_marge_cm).
// Auto-plan-groep herberekent exact na koppeling via claim_wacht_op_inkoop.

import { supabase } from '@/lib/supabase/client'

// ─── Types ──────────────────────────────────────────────────────────────────

/** Eén open IO-regel die als koppelkandidaat getoond kan worden. */
export interface OpenIORegelVoorKoppeling {
  regel_id: number
  inkooporder_nr: string
  leverancier_naam: string | null
  verwacht_datum: string | null
  /** Te leveren meters (resterend van de totale bestelling). */
  te_leveren_m: number
  /** Cm al geclaimd door snijplannen.status='Wacht op inkoop' (mig 438/444). */
  snijplan_gebruikte_lengte_cm: number
  /** Resterend in cm = (te_leveren_m × 100) − snijplan_gebruikte_lengte_cm. */
  resterend_cm: number
}

export interface KoppelResultaat {
  ok: boolean
  gewijzigd: boolean
  bijdrage_cm?: number
  resterend_cm?: number
  reden?: string
}

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Haalt alle open IO-regels op voor een (kwaliteit, kleur) combinatie.
 * Spiegelt fetchOpenInkoopRegels in _shared/db-helpers.ts:
 *   - eenheid = 'm' (impliciete viewfilter)
 *   - exact kwaliteit_code
 *   - kleur_code incl. .0-variant-tolerantie
 *   - FIFO: verwacht_datum ASC NULLS LAST, regel_id ASC
 *
 * MARGE-2.5CM: de resterend_cm die hier getoond wordt veronderstelt dat
 * al-geclaimde stukken ook met 2.5 cm marge zijn bijgedragen. Als die marge
 * verandert → herbereken via auto-plan-groep (claim_wacht_op_inkoop).
 */
export async function fetchOpenInkoopRegelsVoorKoppeling(
  kwaliteitCode: string,
  kleurCode: string,
): Promise<OpenIORegelVoorKoppeling[]> {
  // .0-tolerantie spiegelt getKleurVariants in _shared/db-helpers.ts
  const kleurVarianten: string[] = [kleurCode]
  if (!kleurCode.includes('.')) kleurVarianten.push(`${kleurCode}.0`)
  if (kleurCode.endsWith('.0')) kleurVarianten.push(kleurCode.replace(/\.0$/, ''))

  const { data, error } = await supabase
    .from('openstaande_inkooporder_regels')
    .select('regel_id, inkooporder_nr, leverancier_naam, verwacht_datum, te_leveren_m, snijplan_gebruikte_lengte_cm')
    .eq('eenheid', 'm')
    .eq('kwaliteit_code', kwaliteitCode)
    .in('kleur_code', kleurVarianten)
    .order('verwacht_datum', { ascending: true, nullsFirst: false })
    .order('regel_id', { ascending: true })

  if (error) throw error

  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const te_leveren_m = Number(r.te_leveren_m ?? 0)
    const snijplan_gebruikt = Number(r.snijplan_gebruikte_lengte_cm ?? 0)
    return {
      regel_id: Number(r.regel_id),
      inkooporder_nr: String(r.inkooporder_nr ?? ''),
      leverancier_naam: (r.leverancier_naam as string | null) ?? null,
      verwacht_datum: (r.verwacht_datum as string | null) ?? null,
      te_leveren_m,
      snijplan_gebruikte_lengte_cm: snijplan_gebruikt,
      resterend_cm: Math.round(te_leveren_m * 100) - snijplan_gebruikt,
    }
  })
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Koppelt ALLE koppelbare stuks van een orderregel atomisch aan één IO-regel.
 * Gebruikt koppel_orderregel_aan_io (mig 526) — één transactie,
 * alles-of-niets. Faalt als de IO onvoldoende ruimte heeft voor de
 * som van alle stuk-bijdrages.
 */
export async function koppelOrderregelAanIo(
  orderRegelId: number,
  ioRegelId: number,
): Promise<KoppelResultaat> {
  const { data, error } = await supabase.rpc('koppel_orderregel_aan_io', {
    p_order_regel_id: orderRegelId,
    p_io_regel_id: ioRegelId,
  })
  if (error) {
    // PostgreSQL RAISE EXCEPTION geeft de boodschap terug als plain string.
    // Format: 'code:leesbare tekst' (zie de RPC)
    const msg = error.message ?? 'Onbekende fout'
    const leesbaar = msg.includes(':') ? msg.split(':').slice(1).join(':').trim() : msg
    throw new Error(leesbaar)
  }
  return (data ?? { ok: true, gewijzigd: false }) as KoppelResultaat
}

/**
 * Ontkoppelt ALLE stuks van een orderregel van hun IO-claim.
 * Roept ontkoppel_snijplan_van_io per stuk aan (meerdere RPC-calls).
 * Elk is atomisch; gedeeltelijk succes is mogelijk maar onwaarschijnlijk.
 */
export async function ontkoppelOrderregelVanIo(snijplanIds: number[]): Promise<void> {
  for (const id of snijplanIds) {
    const { error } = await supabase.rpc('ontkoppel_snijplan_van_io', {
      p_snijplan_id: id,
    })
    if (error) {
      const msg = error.message ?? 'Onbekende fout'
      const leesbaar = msg.includes(':') ? msg.split(':').slice(1).join(':').trim() : msg
      throw new Error(leesbaar)
    }
  }
}
