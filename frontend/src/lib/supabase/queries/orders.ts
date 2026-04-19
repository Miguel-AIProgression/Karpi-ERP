import { supabase } from '../client'
import { sanitizeSearch } from '@/lib/utils/sanitize'

export interface OrderRow {
  id: number
  order_nr: string
  oud_order_nr: number | null
  debiteur_nr: number
  klant_referentie: string | null
  orderdatum: string
  afleverdatum: string | null
  status: string
  aantal_regels: number
  totaal_bedrag: number
  totaal_gewicht: number
  vertegenw_code: string | null
  klant_naam?: string
}

export interface OrderDetail extends OrderRow {
  week: string | null
  fact_naam: string | null
  fact_adres: string | null
  fact_postcode: string | null
  fact_plaats: string | null
  fact_land: string | null
  afl_naam: string | null
  afl_naam_2: string | null
  afl_adres: string | null
  afl_postcode: string | null
  afl_plaats: string | null
  afl_land: string | null
  afl_email: string | null
  afl_telefoon: string | null
  opmerkingen: string | null
  betaler: number | null
  inkooporganisatie: string | null
  compleet_geleverd: boolean
  vertegenw_naam?: string
}

export interface OrderRegelSnijplan {
  id: number
  snijplan_nr: string
  status: string
  scancode: string
}

export interface OrderRegel {
  id: number
  regelnummer: number
  artikelnr: string | null
  karpi_code: string | null
  omschrijving: string
  omschrijving_2: string | null
  orderaantal: number
  te_leveren: number
  backorder: number
  prijs: number | null
  korting_pct: number
  bedrag: number | null
  gewicht_kg: number | null
  vrije_voorraad: number | null
  klant_eigen_naam?: string | null
  klant_artikelnr?: string | null
  // Substitutie
  fysiek_artikelnr?: string | null
  omstickeren?: boolean
  fysiek_omschrijving?: string | null
  // Maatwerk
  is_maatwerk?: boolean
  maatwerk_vorm?: string | null
  maatwerk_lengte_cm?: number | null
  maatwerk_breedte_cm?: number | null
  maatwerk_afwerking?: string | null
  maatwerk_band_kleur?: string | null
  maatwerk_instructies?: string | null
  // Productie tracking
  snijplannen?: OrderRegelSnijplan[]
}

export interface StatusCount {
  status: string
  aantal: number
}

export type OrderSortField = 'orderdatum' | 'afleverdatum' | 'klant_naam' | 'totaal_bedrag' | 'aantal_regels' | 'order_nr' | 'status'
export type SortDirection = 'asc' | 'desc'

/** Fetch orders with client name, optionally filtered by status or debiteur */
export async function fetchOrders(params: {
  status?: string
  search?: string
  debiteurNr?: number
  page?: number
  pageSize?: number
  sortBy?: OrderSortField
  sortDir?: SortDirection
}) {
  const { status, search, debiteurNr, page = 0, pageSize = 50, sortBy = 'orderdatum', sortDir = 'desc' } = params

  let query = supabase
    .from('orders_list')
    .select('*', { count: 'exact' })
    .order(sortBy, { ascending: sortDir === 'asc' })
    .range(page * pageSize, (page + 1) * pageSize - 1)

  if (status && status !== 'Alle') {
    query = query.eq('status', status)
  }

  if (debiteurNr) {
    query = query.eq('debiteur_nr', debiteurNr)
  }

  if (search) {
    const s = sanitizeSearch(search)
    if (s) {
      query = query.or(
        `order_nr.ilike.%${s}%,klant_referentie.ilike.%${s}%,klant_naam.ilike.%${s}%`
      )
    }
  }

  const { data, error, count } = await query

  if (error) throw error

  return { orders: (data ?? []) as OrderRow[], totalCount: count ?? 0 }
}

/** Fetch status counts for tabs */
export async function fetchStatusCounts(): Promise<StatusCount[]> {
  const { data, error } = await supabase
    .from('orders_status_telling')
    .select('status, aantal')

  if (error) throw error
  return (data ?? []) as StatusCount[]
}

/** Fetch single order with details */
export async function fetchOrderDetail(id: number): Promise<OrderDetail> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error

  const order = data as Record<string, unknown>

  // Fetch klant naam + klant's vertegenwoordiger as fallback
  let klant_naam = '—'
  let klant_vertegenw_code: string | null = null
  if (order.debiteur_nr) {
    const { data: deb } = await supabase
      .from('debiteuren')
      .select('naam, vertegenw_code')
      .eq('debiteur_nr', order.debiteur_nr)
      .single()
    if (deb) {
      klant_naam = deb.naam
      klant_vertegenw_code = deb.vertegenw_code
    }
  }

  // Gebruik altijd de vertegenw_code van de klant (actueel); fallback op de order zelf
  const effectiveCode = klant_vertegenw_code || (order.vertegenw_code as string | null)
  let vertegenw_naam: string | undefined
  if (effectiveCode) {
    const { data: vtw } = await supabase
      .from('vertegenwoordigers')
      .select('naam')
      .eq('code', effectiveCode)
      .single()
    if (vtw) vertegenw_naam = vtw.naam
  }

  return { ...order, klant_naam, vertegenw_naam } as unknown as OrderDetail
}

/** Fetch order lines enriched with klanteigen namen and klant artikelnummers */
export async function fetchOrderRegels(orderId: number): Promise<OrderRegel[]> {
  // First get the order to know the debiteur_nr
  const { data: orderData } = await supabase
    .from('orders')
    .select('debiteur_nr')
    .eq('id', orderId)
    .single()

  const { data, error } = await supabase
    .from('order_regels')
    .select('id, regelnummer, artikelnr, karpi_code, omschrijving, omschrijving_2, orderaantal, te_leveren, backorder, prijs, korting_pct, bedrag, gewicht_kg, vrije_voorraad, fysiek_artikelnr, omstickeren, is_maatwerk, maatwerk_vorm, maatwerk_lengte_cm, maatwerk_breedte_cm, maatwerk_afwerking, maatwerk_band_kleur, maatwerk_instructies, producten!order_regels_artikelnr_fkey(kwaliteit_code)')
    .eq('order_id', orderId)
    .order('regelnummer')

  if (error) throw error

  const regels = data ?? []
  const debiteurNr = orderData?.debiteur_nr

  // Helper to strip the joined 'producten' field and cast to OrderRegel
  function toRegel(
    r: (typeof regels)[number],
    eigenNaamMap?: Map<string, string>,
    klantArtMap?: Map<string, string>,
    fysiekOmschMap?: Map<string, string>,
  ): OrderRegel {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = r as any
    const product = row.producten as { kwaliteit_code: string } | null
    const kwalCode = product?.kwaliteit_code ?? null

    return {
      id: row.id,
      regelnummer: row.regelnummer,
      artikelnr: row.artikelnr,
      karpi_code: row.karpi_code,
      omschrijving: row.omschrijving,
      omschrijving_2: row.omschrijving_2,
      orderaantal: row.orderaantal,
      te_leveren: row.te_leveren,
      backorder: row.backorder,
      prijs: row.prijs,
      korting_pct: row.korting_pct,
      bedrag: row.bedrag,
      gewicht_kg: row.gewicht_kg,
      vrije_voorraad: row.vrije_voorraad,
      klant_eigen_naam: kwalCode && eigenNaamMap ? eigenNaamMap.get(kwalCode) ?? null : null,
      klant_artikelnr: row.artikelnr && klantArtMap ? klantArtMap.get(row.artikelnr) ?? null : null,
      fysiek_artikelnr: row.fysiek_artikelnr ?? null,
      omstickeren: row.omstickeren ?? false,
      fysiek_omschrijving: row.fysiek_artikelnr && fysiekOmschMap
        ? fysiekOmschMap.get(row.fysiek_artikelnr) ?? null : null,
      is_maatwerk: row.is_maatwerk ?? false,
      maatwerk_vorm: row.maatwerk_vorm ?? null,
      maatwerk_lengte_cm: row.maatwerk_lengte_cm ?? null,
      maatwerk_breedte_cm: row.maatwerk_breedte_cm ?? null,
      maatwerk_afwerking: row.maatwerk_afwerking ?? null,
      maatwerk_band_kleur: row.maatwerk_band_kleur ?? null,
      maatwerk_instructies: row.maatwerk_instructies ?? null,
    }
  }

  // Fetch omschrijving for substituted products
  const fysiekeArtikelnrs = regels
    .map((r: any) => r.fysiek_artikelnr)
    .filter((a: string | null) => a != null) as string[]

  let fysiekOmschMap = new Map<string, string>()
  if (fysiekeArtikelnrs.length > 0) {
    const { data: fysiekData } = await supabase
      .from('producten')
      .select('artikelnr, omschrijving')
      .in('artikelnr', fysiekeArtikelnrs)
    fysiekOmschMap = new Map(
      (fysiekData ?? []).map((p: { artikelnr: string; omschrijving: string }) => [p.artikelnr, p.omschrijving])
    )
  }

  if (!debiteurNr) {
    return regels.map((r) => toRegel(r, undefined, undefined, fysiekOmschMap))
  }

  // Fetch all klanteigen namen for this customer in one query
  const { data: eigenNamen } = await supabase
    .from('klanteigen_namen')
    .select('kwaliteit_code, benaming')
    .eq('debiteur_nr', debiteurNr)

  const eigenNaamMap = new Map(
    (eigenNamen ?? []).map((n: { kwaliteit_code: string; benaming: string }) => [n.kwaliteit_code, n.benaming])
  )

  // Fetch all klant artikelnummers for this customer in one query
  const { data: klantArtNrs } = await supabase
    .from('klant_artikelnummers')
    .select('artikelnr, klant_artikel')
    .eq('debiteur_nr', debiteurNr)

  const klantArtMap = new Map(
    (klantArtNrs ?? []).map((n: { artikelnr: string; klant_artikel: string }) => [n.artikelnr, n.klant_artikel])
  )

  const baseRegels = regels.map((r) => toRegel(r, eigenNaamMap, klantArtMap, fysiekOmschMap))

  // Fetch snijplannen for maatwerk regels
  const maatwerkRegelIds = baseRegels.filter((r) => r.is_maatwerk).map((r) => r.id)
  if (maatwerkRegelIds.length > 0) {
    const { data: snijplanData } = await supabase
      .from('snijplannen')
      .select('id, snijplan_nr, status, scancode, order_regel_id')
      .in('order_regel_id', maatwerkRegelIds)
      .order('snijplan_nr')

    if (snijplanData) {
      const snijplanMap = new Map<number, OrderRegelSnijplan[]>()
      for (const sp of snijplanData) {
        const regelId = sp.order_regel_id as number
        if (!snijplanMap.has(regelId)) snijplanMap.set(regelId, [])
        snijplanMap.get(regelId)!.push({
          id: sp.id,
          snijplan_nr: sp.snijplan_nr,
          status: sp.status,
          scancode: sp.scancode,
        })
      }
      for (const regel of baseRegels) {
        if (snijplanMap.has(regel.id)) {
          regel.snijplannen = snijplanMap.get(regel.id)!
        }
      }
    }
  }

  return baseRegels
}
