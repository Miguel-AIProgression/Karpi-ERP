import { supabase } from '@/lib/supabase/client'
import { filterPickBackorder } from '@/lib/orders/pick-backorder'
import { landNaarIso2 } from '@/lib/utils/land-vlag'

// Manco-werklijst (mig 518): orderregels die tijdens een Pickronde niet gevonden
// zijn (pick_backorder_sinds gezet, nog niet afgehandeld) en wachten op
// binnendienst-beoordeling. De open-manco-definitie leeft op één plek
// (filterPickBackorder); deze module dupliceert het filter niet.

export interface MancoRegel {
  order_regel_id: number
  order_id: number
  order_nr: string
  klant_naam: string | null
  /** Genormaliseerd ISO-2 afleverland (afl_land → debiteur.land). Stuurt de
   *  NL/DE-resolutiekeuze in de werklijst. */
  land: string | null
  omschrijving: string | null
  orderaantal: number | null
  pick_backorder_sinds: string
  pick_backorder_reden: string | null
}

export async function fetchMancoRegels(): Promise<MancoRegel[]> {
  const { data, error } = await filterPickBackorder(
    supabase
      .from('order_regels')
      .select(`
        id, order_id, omschrijving, orderaantal, pick_backorder_sinds, pick_backorder_reden,
        orders!inner (
          order_nr,
          afl_land,
          debiteuren:debiteuren!orders_debiteur_nr_fkey ( naam, land )
        )
      `),
  ).order('pick_backorder_sinds', { ascending: true })

  if (error) throw new Error(`Manco-werklijst ophalen mislukt: ${error.message}`)
  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as {
      id: number
      order_id: number
      omschrijving: string | null
      orderaantal: number | null
      pick_backorder_sinds: string
      pick_backorder_reden: string | null
      orders: {
        order_nr: string
        afl_land: string | null
        debiteuren?: { naam: string | null; land: string | null } | null
      }
    }
    const rawLand = r.orders.afl_land?.trim() || r.orders.debiteuren?.land || null
    return {
      order_regel_id: r.id,
      order_id: r.order_id,
      order_nr: r.orders.order_nr,
      klant_naam: r.orders.debiteuren?.naam ?? null,
      land: landNaarIso2(rawLand),
      omschrijving: r.omschrijving,
      orderaantal: r.orderaantal,
      pick_backorder_sinds: r.pick_backorder_sinds,
      pick_backorder_reden: r.pick_backorder_reden,
    }
  })
}

/** Actie A — Weer beschikbaar → terug naar Pick & Ship (claim stond bevroren). */
export async function mancoTerugNaarPickship(orderRegelId: number): Promise<void> {
  const { error } = await supabase.rpc('manco_terug_naar_pickship', {
    p_order_regel_id: orderRegelId,
  })
  if (error) throw new Error(`Terug naar Pick & Ship mislukt: ${error.message}`)
}

/** Actie B — Niet leverbaar uit voorraad. `corrigeerVoorraad` boekt de telling af
 *  (alleen aanvinken als het stuk fysiek echt weg is). NL → blijft backorder op de
 *  order; DE/buitenland → regel afgesloten. */
export async function mancoNietLeverbaar(
  orderRegelId: number,
  corrigeerVoorraad: boolean,
  reden: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('manco_niet_leverbaar', {
    p_order_regel_id: orderRegelId,
    p_corrigeer_voorraad: corrigeerVoorraad,
    p_reden: reden,
  })
  if (error) throw new Error(`Niet leverbaar verwerken mislukt: ${error.message}`)
}
