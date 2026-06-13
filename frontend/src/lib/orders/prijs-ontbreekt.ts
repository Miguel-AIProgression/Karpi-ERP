// Prijs-ontbreekt-gate-seam (mig 393): bepaalt of een order ≥1 regel zonder
// prijs (€0/NULL) heeft die eerst gecorrigeerd of bewust bevestigd moet worden
// voordat de order naar de werkvloer/facturatie doorstroomt.
//
// Aanleiding: Shopify/webshop-orders kwamen soms binnen met prijs NULL/0
// (haalKlantPrijs → null, create_webshop_order zonder > 0-check). De DB-trigger
// fn_order_regels_prijs_gate is de single source voor detectie (admin-pseudo +
// VERZEND + 100%-korting uitgesloten); deze module spiegelt het predicaat.
//
// Gate-conventie (zoals levertijd_wijziging_te_bevestigen_sinds): één nullable
// timestamp. NULL = geen ontbrekende prijs of bewust geaccepteerd. Wordt gewist
// door markeer_prijs_geaccepteerd (operator accepteert €0) of door prijscorrectie
// (trigger). Eindstatussen (Verzonden/Geannuleerd) tellen niet mee.

export interface PrijsOntbreektVelden {
  prijs_ontbreekt_sinds?: string | null
  status?: string | null
}

/** True als deze order een ontbrekende prijs heeft die nog gecorrigeerd/bevestigd moet worden. */
export function isPrijsOntbreekt(order: PrijsOntbreektVelden): boolean {
  if (!order.prijs_ontbreekt_sinds) return false
  if (order.status === 'Verzonden' || order.status === 'Geannuleerd') return false
  return true
}

// Minimaal structureel contract van de PostgREST-builder (zie intake-predicaten.ts
// voor de cast-rationale).
interface PostgrestNotBuilder {
  not(column: string, operator: string, value: unknown): PostgrestNotBuilder
}

/** Past het 'Prijs ontbreekt'-filter toe op een query-builder (fetchOrders + count). */
export function filterPrijsOntbreekt<Q>(query: Q): Q {
  return (query as unknown as PostgrestNotBuilder)
    .not('prijs_ontbreekt_sinds', 'is', null)
    .not('status', 'in', '("Verzonden","Geannuleerd")') as unknown as Q
}
