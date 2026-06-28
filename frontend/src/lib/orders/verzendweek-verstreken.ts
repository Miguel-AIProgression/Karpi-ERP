// Verzendweek-verstreken-seam: orders waarvan de verzendweek (afleverdatum) in
// het verleden ligt, maar die nog niet (deels) verzonden zijn — achterstallige
// verzendingen. Bedoeld om langst-over-tijd eerst te tonen (afleverdatum oplopend).
//
// Scope: open orders met een verstreken afleverdatum, exclusief (deels-)verzonden/
// geannuleerde orders, oud_systeem en productie-only (Basta verzendt die zelf,
// ADR-0029). Spiegelt hetzelfde filter in fetchOrders / fetchStatusCounts.
// Tegenhanger van de 'Geen verzendweek'-seam (afleverdatum NULL).

const NIET_OPENSTAAND = new Set(['Verzonden', 'Deels verzonden', 'Geannuleerd'])

export interface VerzendweekVerstrekenVelden {
  afleverdatum?: string | null
  status?: string | null
  alleen_productie?: boolean | null
  bron_systeem?: string | null
}

/** Lokale datum als YYYY-MM-DD (geen UTC-shift rond middernacht zoals toISOString). */
export function vandaagISO(d: Date = new Date()): string {
  const mnd = String(d.getMonth() + 1).padStart(2, '0')
  const dag = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mnd}-${dag}`
}

/** True als de verzendweek van deze order verstreken is én hij nog niet (deels)
 *  verzonden is — een achterstallige verzending. Order op exact `today` is nog
 *  niet over tijd. */
export function isVerzendweekVerstreken(
  order: VerzendweekVerstrekenVelden,
  today: string = vandaagISO(),
): boolean {
  if (!order.afleverdatum) return false
  if (NIET_OPENSTAAND.has(order.status ?? '')) return false
  if (order.alleen_productie) return false
  if (order.bron_systeem === 'oud_systeem') return false
  return order.afleverdatum < today
}

interface PostgrestVerstrekenBuilder {
  lt(column: string, value: string): PostgrestVerstrekenBuilder
  eq(column: string, value: unknown): PostgrestVerstrekenBuilder
  not(column: string, operator: string, value: unknown): PostgrestVerstrekenBuilder
}

/** Past het 'Verzendweek verstreken'-filter toe op een query-builder. Werkt op
 *  zowel `orders` als `orders_list`. NULL-afleverdatum valt vanzelf weg
 *  (NULL < x is NULL) — die orders horen bij 'Geen verzendweek'. */
export function filterVerzendweekVerstreken<Q>(query: Q, today: string = vandaagISO()): Q {
  return (query as unknown as PostgrestVerstrekenBuilder)
    .lt('afleverdatum', today)
    .not('status', 'in', '("Verzonden","Deels verzonden","Geannuleerd")')
    .eq('alleen_productie', false)
    .not('bron_systeem', 'eq', 'oud_systeem') as unknown as Q
}
