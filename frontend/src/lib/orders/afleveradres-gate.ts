// Afleveradres-gate-seam (mig 392): bepaalt of een order een onvolledig
// afleveradres-snapshot heeft dat eerst aangevuld moet worden voordat de order
// naar de werkvloer (Pick & Ship) mag doorstromen.
//
// Aanleiding: ORD-2026-0097 belandde zonder afleveradres in Pick & Ship →
// labels/stickers zonder adres. Geen enkel intake-kanaal valideerde de
// afl_*-snapshots. De DB-trigger fn_orders_afl_adres_gate is de single source
// voor detectie; deze module spiegelt het predicaat naar de frontend.
//
// Gate-conventie (zoals levertijd_wijziging_te_bevestigen_sinds / debiteur_zeker):
// orders.afl_adres_incompleet_sinds = NULL → compleet; TIMESTAMPTZ → incompleet
// sinds dat moment. Wordt door de trigger gewist zodra het adres compleet is —
// geen handmatige bevestiging nodig (anders dan de prijs-gate). Eindstatussen
// (Verzonden/Geannuleerd) en afhaal-orders tellen niet mee; dat zit al in de
// trigger verwerkt zodat afl_adres_incompleet_sinds dan NULL is.

export interface AfleveradresGateVelden {
  afl_adres_incompleet_sinds?: string | null
  status?: string | null
}

/** True als deze order een onvolledig afleveradres heeft dat nog aangevuld moet worden. */
export function isAfleveradresIncompleet(order: AfleveradresGateVelden): boolean {
  if (!order.afl_adres_incompleet_sinds) return false
  if (order.status === 'Verzonden' || order.status === 'Geannuleerd') return false
  return true
}

// Minimaal structureel contract van de PostgREST-builder (zie intake-predicaten.ts
// voor waarom we niet als generic-constraint binden maar intern casten).
interface PostgrestNotBuilder {
  not(column: string, operator: string, value: unknown): PostgrestNotBuilder
}

/** Past het 'Afleveradres ontbreekt'-filter toe op een query-builder (fetchOrders + count). */
export function filterAfleveradresIncompleet<Q>(query: Q): Q {
  return (query as unknown as PostgrestNotBuilder)
    .not('afl_adres_incompleet_sinds', 'is', null)
    .not('status', 'in', '("Verzonden","Geannuleerd")') as unknown as Q
}

// --- Pure adres-completeness-check voor het order-formulier --------------------
// Spiegelt de SQL-conditie in fn_orders_afl_adres_gate één-op-één: een
// niet-afhaal-order heeft naam + adres + postcode + plaats nodig (niet-leeg na
// trim). afl_land valt bewust buiten de set (stuurt vervoerderkeuze, niet het
// label-adres). De form blokkeert opslaan zolang dit false is.

export interface AfleveradresFormVelden {
  afl_naam?: string | null
  afl_adres?: string | null
  afl_postcode?: string | null
  afl_plaats?: string | null
}

function gevuld(waarde: string | null | undefined): boolean {
  return typeof waarde === 'string' && waarde.trim().length > 0
}

/**
 * True als het afleveradres compleet genoeg is voor verzending. Afhaal-orders
 * (afhalen=true) hebben geen verzendadres nodig en zijn altijd compleet.
 */
export function isAfleveradresCompleet(velden: AfleveradresFormVelden, afhalen?: boolean): boolean {
  if (afhalen) return true
  return (
    gevuld(velden.afl_naam) &&
    gevuld(velden.afl_adres) &&
    gevuld(velden.afl_postcode) &&
    gevuld(velden.afl_plaats)
  )
}

/** Welke afleveradres-velden ontbreken (voor een gerichte form-foutmelding). */
export function ontbrekendeAfleveradresVelden(velden: AfleveradresFormVelden): string[] {
  const ontbreekt: string[] = []
  if (!gevuld(velden.afl_naam)) ontbreekt.push('naam')
  if (!gevuld(velden.afl_adres)) ontbreekt.push('adres')
  if (!gevuld(velden.afl_postcode)) ontbreekt.push('postcode')
  if (!gevuld(velden.afl_plaats)) ontbreekt.push('plaats')
  return ontbreekt
}
