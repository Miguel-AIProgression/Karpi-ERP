import { supabase } from '../client'

export interface OrderFormData {
  debiteur_nr: number
  klant_referentie?: string
  afleverdatum?: string
  week?: string
  vertegenw_code?: string
  betaler?: number
  inkooporganisatie?: string
  fact_naam?: string
  fact_adres?: string
  fact_postcode?: string
  fact_plaats?: string
  fact_land?: string
  afl_naam?: string
  afl_naam_2?: string
  afl_adres?: string
  afl_postcode?: string
  afl_plaats?: string
  afl_land?: string
}

export interface OrderRegelFormData {
  id?: number
  artikelnr?: string
  karpi_code?: string
  omschrijving: string
  omschrijving_2?: string
  orderaantal: number
  te_leveren: number
  prijs?: number
  korting_pct: number
  bedrag?: number
  gewicht_kg?: number
  // Display-only fields (not sent to RPC)
  vrije_voorraad?: number
  besteld_inkoop?: number
  klant_eigen_naam?: string
  klant_artikelnr?: string
  // Substitutie fields
  fysiek_artikelnr?: string
  fysiek_omschrijving?: string  // Display-only
  omstickeren?: boolean
  // Maatwerk fields
  is_maatwerk?: boolean
  maatwerk_vorm?: string
  maatwerk_lengte_cm?: number
  maatwerk_breedte_cm?: number
  maatwerk_afwerking?: string
  maatwerk_band_kleur?: string
  maatwerk_instructies?: string
  // Op-maat prijscomponenten (nieuw)
  maatwerk_m2_prijs?: number
  maatwerk_kostprijs_m2?: number
  maatwerk_oppervlak_m2?: number
  maatwerk_vorm_toeslag?: number
  maatwerk_afwerking_prijs?: number
  maatwerk_diameter_cm?: number
  maatwerk_kwaliteit_code?: string
  maatwerk_kleur_code?: string
  // Display-only: voorraad in m² (niet opgeslagen in DB)
  maatwerk_beschikbaar_m2?: number
  maatwerk_equiv_m2?: number
}

/** Create order + lines atomically via RPC */
export async function createOrder(
  order: OrderFormData,
  regels: OrderRegelFormData[]
) {
  const p_order = {
    debiteur_nr: order.debiteur_nr,
    orderdatum: new Date().toISOString().split('T')[0],
    afleverdatum: order.afleverdatum || null,
    klant_referentie: order.klant_referentie || null,
    week: order.week || null,
    vertegenw_code: order.vertegenw_code || null,
    betaler: order.betaler || null,
    inkooporganisatie: order.inkooporganisatie || null,
    fact_naam: order.fact_naam || null,
    fact_adres: order.fact_adres || null,
    fact_postcode: order.fact_postcode || null,
    fact_plaats: order.fact_plaats || null,
    fact_land: order.fact_land || null,
    afl_naam: order.afl_naam || null,
    afl_naam_2: order.afl_naam_2 || null,
    afl_adres: order.afl_adres || null,
    afl_postcode: order.afl_postcode || null,
    afl_plaats: order.afl_plaats || null,
    afl_land: order.afl_land || null,
  }

  const p_regels = regels.map((r, i) => ({
    regelnummer: i + 1,
    artikelnr: r.artikelnr || null,
    karpi_code: r.karpi_code || null,
    omschrijving: r.omschrijving,
    omschrijving_2: r.omschrijving_2 || null,
    orderaantal: r.orderaantal,
    te_leveren: r.te_leveren,
    prijs: r.prijs ?? null,
    korting_pct: r.korting_pct,
    bedrag: r.bedrag ?? null,
    gewicht_kg: r.gewicht_kg ?? null,
    fysiek_artikelnr: r.fysiek_artikelnr || null,
    omstickeren: r.omstickeren ?? false,
    is_maatwerk: r.is_maatwerk ?? false,
    maatwerk_vorm: r.maatwerk_vorm || null,
    maatwerk_lengte_cm: r.maatwerk_lengte_cm ?? null,
    maatwerk_breedte_cm: r.maatwerk_breedte_cm ?? null,
    maatwerk_afwerking: r.maatwerk_afwerking || null,
    maatwerk_band_kleur: r.maatwerk_band_kleur || null,
    maatwerk_instructies: r.maatwerk_instructies || null,
    maatwerk_m2_prijs: r.maatwerk_m2_prijs ?? null,
    maatwerk_kostprijs_m2: r.maatwerk_kostprijs_m2 ?? null,
    maatwerk_oppervlak_m2: r.maatwerk_oppervlak_m2 ?? null,
    maatwerk_vorm_toeslag: r.maatwerk_vorm_toeslag ?? null,
    maatwerk_afwerking_prijs: r.maatwerk_afwerking_prijs ?? null,
    maatwerk_diameter_cm: r.maatwerk_diameter_cm ?? null,
    maatwerk_kwaliteit_code: r.maatwerk_kwaliteit_code || null,
    maatwerk_kleur_code: r.maatwerk_kleur_code || null,
  }))

  const { data, error } = await supabase.rpc('create_order_with_lines', {
    p_order: p_order,
    p_regels: p_regels,
  })

  if (error) throw error
  return data as { id: number; order_nr: string }
}

/** Update order header + replace lines atomically via RPC */
export async function updateOrderWithLines(
  orderId: number,
  header: Partial<OrderFormData>,
  regels: OrderRegelFormData[]
) {
  const p_regels = regels.map((r, i) => ({
    id: r.id ?? null,
    regelnummer: i + 1,
    artikelnr: r.artikelnr || null,
    karpi_code: r.karpi_code || null,
    omschrijving: r.omschrijving,
    omschrijving_2: r.omschrijving_2 || null,
    orderaantal: r.orderaantal,
    te_leveren: r.te_leveren,
    prijs: r.prijs ?? null,
    korting_pct: r.korting_pct,
    bedrag: r.bedrag ?? null,
    gewicht_kg: r.gewicht_kg ?? null,
    fysiek_artikelnr: r.fysiek_artikelnr || null,
    omstickeren: r.omstickeren ?? false,
    is_maatwerk: r.is_maatwerk ?? false,
    maatwerk_vorm: r.maatwerk_vorm || null,
    maatwerk_lengte_cm: r.maatwerk_lengte_cm ?? null,
    maatwerk_breedte_cm: r.maatwerk_breedte_cm ?? null,
    maatwerk_afwerking: r.maatwerk_afwerking || null,
    maatwerk_band_kleur: r.maatwerk_band_kleur || null,
    maatwerk_instructies: r.maatwerk_instructies || null,
    maatwerk_m2_prijs: r.maatwerk_m2_prijs ?? null,
    maatwerk_kostprijs_m2: r.maatwerk_kostprijs_m2 ?? null,
    maatwerk_oppervlak_m2: r.maatwerk_oppervlak_m2 ?? null,
    maatwerk_vorm_toeslag: r.maatwerk_vorm_toeslag ?? null,
    maatwerk_afwerking_prijs: r.maatwerk_afwerking_prijs ?? null,
    maatwerk_diameter_cm: r.maatwerk_diameter_cm ?? null,
    maatwerk_kwaliteit_code: r.maatwerk_kwaliteit_code || null,
    maatwerk_kleur_code: r.maatwerk_kleur_code || null,
  }))

  const { error } = await supabase.rpc('update_order_with_lines', {
    p_order_id: orderId,
    p_header: header,
    p_regels: p_regels,
  })

  if (error) throw error
}

/** Update order status */
export async function updateOrderStatus(orderId: number, status: string) {
  const { error } = await supabase
    .from('orders')
    .update({ status })
    .eq('id', orderId)

  if (error) throw error
}

/** Delete order, its lines, and recalculate stock reservations via RPC */
export async function deleteOrder(orderId: number) {
  const { error } = await supabase.rpc('delete_order', {
    p_order_id: orderId,
  })

  if (error) throw error
}

/** Lookup price for an article in a client's price list */
export async function lookupPrice(prijslijstNr: string, artikelnr: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('prijslijst_regels')
    .select('prijs')
    .eq('prijslijst_nr', prijslijstNr)
    .eq('artikelnr', artikelnr)
    .maybeSingle()

  if (error) throw error
  return data?.prijs ?? null
}

/** Fetch klanteigen naam for a quality code + customer */
export async function fetchKlanteigenNaam(debiteurNr: number, kwaliteitCode: string) {
  const { data, error } = await supabase
    .from('klanteigen_namen')
    .select('benaming, omschrijving')
    .eq('debiteur_nr', debiteurNr)
    .eq('kwaliteit_code', kwaliteitCode)
    .maybeSingle()

  if (error) throw error
  return data as { benaming: string; omschrijving: string | null } | null
}

/** Fetch klant artikelnummer for an article + customer */
export async function fetchKlantArtikelnummer(debiteurNr: number, artikelnr: string) {
  const { data, error } = await supabase
    .from('klant_artikelnummers')
    .select('klant_artikel, omschrijving')
    .eq('debiteur_nr', debiteurNr)
    .eq('artikelnr', artikelnr)
    .maybeSingle()

  if (error) throw error
  return data as { klant_artikel: string; omschrijving: string | null } | null
}

/** Fetch prijslijst_nr and korting_pct for a debiteur (needed in edit mode) */
export async function fetchClientCommercialData(debiteurNr: number) {
  const { data, error } = await supabase
    .from('debiteuren')
    .select('prijslijst_nr, korting_pct, gratis_verzending, verzendkosten, verzend_drempel, standaard_maat_werkdagen, maatwerk_weken, deelleveringen_toegestaan')
    .eq('debiteur_nr', debiteurNr)
    .single()

  if (error) throw error
  return data as { prijslijst_nr: string | null; korting_pct: number; gratis_verzending: boolean; verzendkosten: number; verzend_drempel: number; standaard_maat_werkdagen: number | null; maatwerk_weken: number | null; deelleveringen_toegestaan: boolean }
}

/** Update only the afwerking (+ optional band_kleur) on a single order_regel — used for locked orders where
 *  everything else is immutable but afwerking was still pending. */
export async function updateRegelAfwerking(
  regelId: number,
  afwerking: string,
  bandKleur: string | null,
) {
  const { error } = await supabase
    .from('order_regels')
    .update({
      maatwerk_afwerking: afwerking,
      maatwerk_band_kleur: bandKleur,
    })
    .eq('id', regelId)

  if (error) throw error
}
