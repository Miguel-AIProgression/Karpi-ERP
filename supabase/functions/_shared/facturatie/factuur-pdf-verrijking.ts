// PDF-specifieke verrijking die op ALLE facturen van toepassing is (niet
// alleen intracommunautaire — zie intracom-statregel.ts voor die kant).
// Gedeeld tussen de on-demand preview (factuur-pdf) en de daadwerkelijk
// verzonden factuur (factuur-verzenden), mig 450:
//
//   - EDI-prefix op "Uw Referentie" zodra de order via EDI binnenkwam
//     (orders.bron_systeem='edi') — zichtbaar via welk kanaal de order kwam.
//   - "Auftrag"-regel (orders.oud_order_nr) voor gemigreerde Basta-orders.
//   - Debiteur-specifieke betaalconditie i.p.v. de bedrijfsbrede default
//     (bug gevonden 2026-06-20: PDF toonde altijd bedrijf.betalingscondities_tekst).

// deno-lint-ignore no-explicit-any
type SupabaseClient = any

export interface OrderPdfMeta {
  bron_systeem: string | null
  oud_order_nr: string | null
}

/** orders.bron_systeem + oud_order_nr per order_id. */
export async function fetchOrderPdfMeta(
  supabase: SupabaseClient,
  orderIds: number[],
): Promise<Map<number, OrderPdfMeta>> {
  const result = new Map<number, OrderPdfMeta>()
  if (orderIds.length === 0) return result
  const { data, error } = await supabase
    .from('orders')
    .select('id, bron_systeem, oud_order_nr')
    .in('id', orderIds)
  if (error) throw new Error(`Fetch orders (pdf-meta): ${error.message}`)
  for (const o of (data ?? []) as { id: number; bron_systeem: string | null; oud_order_nr: string | null }[]) {
    result.set(o.id, { bron_systeem: o.bron_systeem, oud_order_nr: o.oud_order_nr })
  }
  return result
}

/** "EDI: <ref>" als de order via EDI binnenkwam, anders ongewijzigd. */
export function metEdiPrefix(uwReferentie: string, meta: OrderPdfMeta | undefined): string {
  if (meta?.bron_systeem === 'edi' && uwReferentie) return `EDI: ${uwReferentie}`
  return uwReferentie
}

/** Debiteur-specifieke betaalconditie-tekst; undefined → caller valt terug op bedrijf-default. */
export async function fetchBetaalconditie(
  supabase: SupabaseClient,
  debiteurNr: number,
): Promise<string | undefined> {
  const { data, error } = await supabase
    .from('debiteuren')
    .select('betaalconditie')
    .eq('debiteur_nr', debiteurNr)
    .maybeSingle()
  if (error) throw new Error(`Fetch debiteur (betaalconditie): ${error.message}`)
  return (data as { betaalconditie: string | null } | null)?.betaalconditie ?? undefined
}
