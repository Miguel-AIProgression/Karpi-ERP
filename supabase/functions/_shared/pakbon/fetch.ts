// Server-side fetch van de pakbon-data. Spiegelt de frontend
// `fetchZendingPrintSet` (queries/zendingen.ts) maar haalt alleen de velden op
// die het canonieke PakbonDocument nodig heeft. Gedeeld door de pakbon-pdf en
// stuur-verzendbevestiging edge functions.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { PakbonBundelOrder, PakbonZendingInput } from './types.ts'

const PAKBON_SELECT = `
  zending_nr, verzenddatum, created_at, is_deelzending,
  afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land, afl_telefoon,
  aantal_colli, totaal_gewicht_kg,
  orders!zendingen_order_id_fkey!inner (
    id, order_nr, klant_referentie, week, debiteur_nr, vertegenw_code,
    fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land, afl_naam_2,
    debiteuren:debiteuren!orders_debiteur_nr_fkey ( naam ),
    vertegenwoordigers ( naam )
  ),
  zending_orders (
    order_id,
    bundel_order:orders!zending_orders_order_id_fkey ( id, order_nr, klant_referentie, week )
  ),
  zending_regels (
    id, order_regel_id, artikelnr, aantal,
    order_regels (
      order_id, regelnummer, artikelnr, omschrijving, omschrijving_2,
      orderaantal, te_leveren, gewicht_kg, is_maatwerk,
      maatwerk_lengte_cm, maatwerk_breedte_cm,
      maatwerk_afwerking, maatwerk_band_kleur,
      producten!order_regels_artikelnr_fkey ( omschrijving, gewicht_kg )
    )
  ),
  zending_colli ( colli_nr, sscc, order_regel_id, omschrijving_snapshot, klant_omschrijving_snapshot, omsticker_snapshot )
`

/** Haalt één zending op en levert een `PakbonZendingInput` (bundel platgeslagen). */
export async function fetchPakbonZending(
  supabase: SupabaseClient,
  zending_nr: string,
): Promise<PakbonZendingInput> {
  const { data, error } = await supabase
    .from('zendingen')
    .select(PAKBON_SELECT)
    .eq('zending_nr', zending_nr)
    .single()

  if (error) throw new Error(`Pakbon-zending ophalen mislukt: ${error.message}`)
  if (!data) throw new Error(`Zending ${zending_nr} niet gevonden`)

  return platslaanBundel(data as unknown as PakbonZendingRaw)
}

interface PakbonZendingRaw extends Omit<PakbonZendingInput, 'bundel_orders'> {
  zending_orders?: Array<{ order_id: number; bundel_order: PakbonBundelOrder | null }>
}

function platslaanBundel(raw: PakbonZendingRaw): PakbonZendingInput {
  const bundel_orders: PakbonBundelOrder[] = (raw.zending_orders ?? [])
    .map((row) => row.bundel_order)
    .filter((o): o is PakbonBundelOrder => o != null)
    .sort((a, b) => a.order_nr.localeCompare(b.order_nr))

  // Defensieve fallback: ontbreekt de M2M, val terug op de primaire order.
  if (bundel_orders.length === 0 && raw.orders) {
    bundel_orders.push({
      id: raw.orders.id,
      order_nr: raw.orders.order_nr,
      klant_referentie: raw.orders.klant_referentie,
      week: raw.orders.week,
    })
  }

  return { ...raw, bundel_orders }
}
