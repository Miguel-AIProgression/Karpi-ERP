import { supabase } from '../client'
import { sanitizeSearch } from '@/lib/utils/sanitize'
import { fetchKlanteigenNamenMap } from '@/modules/debiteuren'

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
  heeft_unmatched_regels?: boolean
  bron_systeem?: string | null
  bron_shop?: string | null
  /** EDI (mig 158): tijdstip waarop de leverweek/orderbev bevestigd is. NULL = te bevestigen. */
  edi_bevestigd_op?: string | null
  /** EDI (mig 309): door de partner gewenste leverdatum (snapshot). NULL voor niet-EDI. */
  edi_gewenste_afleverdatum?: string | null
  /** Mig 322: FALSE = debiteur via onzekere (fuzzy) strategie geraden → te bevestigen. */
  debiteur_zeker?: boolean
  /** Mig 322: welke strategie de debiteur bepaalde (bv. company_name_ilike, env_fallback). */
  debiteur_match_bron?: string | null
  /** ADR 0014 / mig 244 — overzicht toont 'Wk X · YYYY' bij 'week', dag-badge bij 'datum'. */
  lever_type?: 'week' | 'datum'
  /** ADR-0016 / mig 259 — bundel-info uit zending_orders M2M. NULL voor solo-orders. */
  bundel_zending_id?: number | null
  bundel_zending_nr?: string | null
  bundel_order_count?: number | null
  /**
   * ADR-0027 / Ingreep 5 — TRUE als de order in de laatste 30 dagen een
   * `order_events`-rij heeft met `event_type='deadline_conflict_na_swap'`.
   * Wordt in `fetchOrders` per pagina-batch in één extra query opgehaald
   * (geen N+1) en als vlag op de OrderRow geplakt. UI toont rode chip.
   * Wanneer `order_events` door RLS niet leesbaar is, blijft de vlag FALSE.
   */
  heeft_deadline_conflict_na_swap?: boolean
  /** Datum van het laatste deadline_conflict_na_swap-event (ISO), voor tooltip. */
  deadline_conflict_na_swap_at?: string | null
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
  lever_modus: 'deelleveringen' | 'in_een_keer' | null
  afhalen: boolean
  /** ADR 0014 / mig 244: 'week' = ergens binnen de leverweek (B2B-default);
   *  'datum' = specifieke leverdag-belofte (B2C, prominentere weergave + striktere
   *  pick-horizon + snij-prioriteit). */
  lever_type: 'week' | 'datum'
  verzonden_at: string | null
  bevestigd_at: string | null
  bevestigd_door: string | null
  bevestiging_email: string | null
  klant_email: string | null
}

export interface OrderRegelSnijplan {
  id: number
  snijplan_nr: string
  status: string
  scancode: string
  locatie: string | null
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
  /** Admin-pseudo-flag (mig 272 / ADR-0018) — gemapt uit producten.is_pseudo via join. */
  is_pseudo?: boolean
  // Substitutie
  fysiek_artikelnr?: string | null
  omstickeren?: boolean
  fysiek_omschrijving?: string | null
  // Maatwerk
  is_maatwerk?: boolean
  maatwerk_vorm?: string | null
  maatwerk_lengte_cm?: number | null
  maatwerk_breedte_cm?: number | null
  maatwerk_diameter_cm?: number | null
  maatwerk_afwerking?: string | null
  maatwerk_band_kleur?: string | null
  maatwerk_instructies?: string | null
  maatwerk_m2_prijs?: number | null
  maatwerk_oppervlak_m2?: number | null
  maatwerk_vorm_toeslag?: number | null
  maatwerk_afwerking_prijs?: number | null
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
  debiteurNrs?: number[]
  bronSystemen?: string[]
  page?: number
  pageSize?: number
  sortBy?: OrderSortField
  sortDir?: SortDirection
}) {
  const { status, search, debiteurNr, debiteurNrs, bronSystemen, page = 0, pageSize = 50, sortBy = 'orderdatum', sortDir = 'desc' } = params

  let query = supabase
    .from('orders_list')
    .select('*', { count: 'exact' })
    .order(sortBy, { ascending: sortDir === 'asc' })
    // Tiebreaker: id is monotoon stijgend (auto-increment) → bij gelijke
    // sort-waarde (typisch: meerdere orders op dezelfde orderdatum) komt de
    // laatst-aangemaakte order bovenaan. orders heeft geen aangemaakt_op
    // kolom, dus id DESC is de pragmatische proxy. Zie issue #34.
    .order('id', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)

  if (status === 'Actie vereist') {
    // Union: 'Wacht op voorraad' / 'Wacht op inkoop' (blocking-fases uit
    // ADR-0016) + webshop-orders met ≥1 regel zonder artikelnr-koppeling.
    // Legacy 'Actie vereist' status (mig 144 timeframe) wordt ook nog
    // herkend voor historische data.
    query = query.or(
      'status.eq.Wacht op voorraad,status.eq.Wacht op inkoop,status.eq.Actie vereist,heeft_unmatched_regels.eq.true'
    )
  } else if (status === 'Te bevestigen') {
    // EDI-orders waarvan de leverweek nog bevestigd moet worden (mig 309).
    // Status-overstijgend: filtert op bron + ontbrekende bevestiging.
    // Geannuleerde orders uitgesloten: die hoeven geen leverweek-bevestiging
    // (annuleren vereist geen bevestiging, dus edi_bevestigd_op blijft NULL).
    query = query
      .eq('bron_systeem', 'edi')
      .is('edi_bevestigd_op', null)
      .neq('status', 'Geannuleerd')
  } else if (status === 'Debiteur te bevestigen') {
    // Mig 322: orders waarvan de debiteur via een onzekere fuzzy strategie
    // geraden is. env_fallback (verzameldebiteur) is bewust géén fout en valt
    // af. Status-overstijgend; geannuleerde orders uitgesloten. De bron-OR is
    // NULL-safe: een onzekere order zonder vastgelegde bron telt mee (alleen
    // expliciet env_fallback valt af) — anders zou hij stil uit beeld vallen,
    // wat de "geen order verloren"-garantie ondermijnt. Spiegelt de JS-conditie
    // op order-detail én countTeBevestigenDebiteurOrders.
    query = query
      .eq('debiteur_zeker', false)
      .or('debiteur_match_bron.is.null,debiteur_match_bron.neq.env_fallback')
      .neq('status', 'Geannuleerd')
  } else if (status && status !== 'Alle') {
    query = query.eq('status', status)
  }

  if (debiteurNrs && debiteurNrs.length > 0) {
    query = query.in('debiteur_nr', debiteurNrs)
  } else if (debiteurNr) {
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

  if (bronSystemen && bronSystemen.length > 0) {
    // 'handmatig' is de UI-sleutel voor NULL of expliciet 'handmatig' in de DB.
    const heeftHandmatig = bronSystemen.includes('handmatig')
    const overige = bronSystemen.filter((b) => b !== 'handmatig')
    const orParts: string[] = []
    if (heeftHandmatig) orParts.push('bron_systeem.is.null', 'bron_systeem.eq.handmatig')
    for (const b of overige) orParts.push(`bron_systeem.eq.${b}`)
    query = query.or(orParts.join(','))
  }

  const { data, error, count } = await query

  if (error) throw error

  const orders = (data ?? []) as OrderRow[]

  // ADR-0027 / Ingreep 5 — verrijk de pagina-batch met de
  // `deadline_conflict_na_swap`-vlag in één extra query (geen N+1).
  // Tijdsvenster: laatste 30 dagen. Bij meerdere events per order pakken
  // we de meest recente (sorteren op created_at DESC). Faalt deze query
  // (bv. RLS-blokker), dan loggen we maar laten de orders-lijst staan —
  // de chip wordt simpelweg niet getoond.
  if (orders.length > 0) {
    const orderIds = orders.map((o) => o.id)
    const sinds = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: events, error: eventsError } = await supabase
      .from('order_events')
      .select('order_id, created_at')
      .eq('event_type', 'deadline_conflict_na_swap')
      .in('order_id', orderIds)
      .gte('created_at', sinds)
      .order('created_at', { ascending: false })

    if (eventsError) {
      // Niet fataal — orders blijven zichtbaar zonder vlag. Bv. RLS-blokker
      // op order_events SELECT-pad; rapport zou dan een SELECT-policy of
      // RPC-laag voorstellen.
      console.warn(
        '[fetchOrders] kon deadline_conflict_na_swap-events niet ophalen',
        eventsError,
      )
    } else {
      const laatsteConflictPerOrder = new Map<number, string>()
      for (const ev of (events ?? []) as { order_id: number; created_at: string }[]) {
        // ASC false op .order, dus eerste hit per order_id is de meest recente.
        if (!laatsteConflictPerOrder.has(ev.order_id)) {
          laatsteConflictPerOrder.set(ev.order_id, ev.created_at)
        }
      }
      for (const o of orders) {
        const conflictAt = laatsteConflictPerOrder.get(o.id)
        if (conflictAt) {
          o.heeft_deadline_conflict_na_swap = true
          o.deadline_conflict_na_swap_at = conflictAt
        }
      }
    }
  }

  return { orders, totalCount: count ?? 0 }
}

/** Fetch status counts for tabs. "Actie vereist" wordt aangevuld met orders
 * die heeft_unmatched_regels=true hebben (webshop-review), zodat die tab
 * altijd reflecteert wat er in de lijst verschijnt bij selectie.
 */
export async function fetchStatusCounts(): Promise<StatusCount[]> {
  const [tellingRes, unmatchedRes, teBevestigenRes, debiteurTeBevestigenRes] = await Promise.all([
    supabase.from('orders_status_telling').select('status, aantal'),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('heeft_unmatched_regels', true)
      .neq('status', 'Actie vereist'),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('bron_systeem', 'edi')
      .is('edi_bevestigd_op', null)
      .neq('status', 'Geannuleerd'),
    countTeBevestigenDebiteurOrders(),
  ])

  if (tellingRes.error) throw tellingRes.error

  const counts = (tellingRes.data ?? []) as StatusCount[]
  const extraUnmatched = unmatchedRes.count ?? 0

  if (extraUnmatched > 0) {
    const existing = counts.find((c) => c.status === 'Actie vereist')
    if (existing) existing.aantal += extraUnmatched
    else counts.push({ status: 'Actie vereist', aantal: extraUnmatched })
  }

  const teBevestigen = teBevestigenRes.count ?? 0
  if (teBevestigen > 0) {
    counts.push({ status: 'Te bevestigen', aantal: teBevestigen })
  }

  if (debiteurTeBevestigenRes > 0) {
    counts.push({ status: 'Debiteur te bevestigen', aantal: debiteurTeBevestigenRes })
  }

  return counts
}

/**
 * Aantal orders met een onzekere (fuzzy) debiteur-match die nog bevestigd moet
 * worden (mig 322). Voedt zowel de status-tab-telling als de waarschuwingsbanner
 * op het orders-overzicht. env_fallback (verzameldebiteur) is bewust uitgesloten
 * — dat is de verwachte eindbestemming voor consumenten-webshops, geen fout.
 * Eén bron-van-waarheid voor het predicaat; pas hier én in fetchOrders
 * ('Debiteur te bevestigen'-branch) aan als het ooit moet wijzigen.
 */
export async function countTeBevestigenDebiteurOrders(): Promise<number> {
  const { count, error } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('debiteur_zeker', false)
    // NULL-safe: alleen expliciet env_fallback valt af; een onzekere order
    // zonder vastgelegde bron telt mee (zie fetchOrders-branch + order-detail).
    .or('debiteur_match_bron.is.null,debiteur_match_bron.neq.env_fallback')
    .neq('status', 'Geannuleerd')
  if (error) throw error
  return count ?? 0
}

export interface OrderKlantOptie {
  debiteur_nr: number
  klant_naam: string
}

/** Distinct (debiteur, naam) over alle orders — voedt het klant-filter op de
 * orders-overview. Lichtgewicht select (geen `count`), JS-dedupe omdat
 * PostgREST geen DISTINCT ondersteunt. Range ruim bemeten op de huidige
 * order-volumes; vervang door een DB-view als dit knelt. */
export async function fetchOrderKlantOpties(): Promise<OrderKlantOptie[]> {
  const { data, error } = await supabase
    .from('orders_list')
    .select('debiteur_nr, klant_naam')
    .range(0, 9999)

  if (error) throw error

  const map = new Map<number, string>()
  for (const r of (data ?? []) as { debiteur_nr: number; klant_naam: string | null }[]) {
    if (!map.has(r.debiteur_nr)) {
      map.set(r.debiteur_nr, r.klant_naam ?? `Debiteur ${r.debiteur_nr}`)
    }
  }
  return Array.from(map, ([debiteur_nr, klant_naam]) => ({ debiteur_nr, klant_naam })).sort(
    (a, b) => a.klant_naam.localeCompare(b.klant_naam, 'nl', { sensitivity: 'base' }),
  )
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
      .select('naam, vertegenw_code, email_factuur, email_overig')
      .eq('debiteur_nr', order.debiteur_nr)
      .single()
    if (deb) {
      klant_naam = deb.naam
      klant_vertegenw_code = deb.vertegenw_code
      ;(order as Record<string, unknown>).klant_email = deb.email_factuur ?? deb.email_overig ?? null
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
    .select('id, regelnummer, artikelnr, karpi_code, omschrijving, omschrijving_2, orderaantal, te_leveren, backorder, prijs, korting_pct, bedrag, gewicht_kg, vrije_voorraad, fysiek_artikelnr, omstickeren, is_maatwerk, maatwerk_vorm, maatwerk_lengte_cm, maatwerk_breedte_cm, maatwerk_diameter_cm, maatwerk_afwerking, maatwerk_band_kleur, maatwerk_instructies, maatwerk_m2_prijs, maatwerk_oppervlak_m2, maatwerk_vorm_toeslag, maatwerk_afwerking_prijs, producten!order_regels_artikelnr_fkey(kwaliteit_code, kleur_code, is_pseudo, karpi_code)')
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
    const product = row.producten as { kwaliteit_code: string; kleur_code: string | null; is_pseudo: boolean | null; karpi_code: string | null } | null
    const kwalCode = product?.kwaliteit_code ?? null
    const kleurCode = product?.kleur_code ?? null
    const isPseudo = product?.is_pseudo === true

    let klantEigenNaam: string | null = null
    if (kwalCode && eigenNaamMap) {
      // Specifieke (kwaliteit, kleur)-match wint van de kwaliteit-fallback (kleur=NULL).
      const specifiek = kleurCode ? eigenNaamMap.get(`${kwalCode}_${kleurCode}`) : undefined
      const fallback = eigenNaamMap.get(`${kwalCode}_`)
      klantEigenNaam = specifiek ?? fallback ?? null
    }

    return {
      id: row.id,
      regelnummer: row.regelnummer,
      artikelnr: row.artikelnr,
      karpi_code: row.karpi_code ?? product?.karpi_code ?? null,
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
      klant_eigen_naam: klantEigenNaam,
      klant_artikelnr: row.artikelnr && klantArtMap ? klantArtMap.get(row.artikelnr) ?? null : null,
      is_pseudo: isPseudo,  // mig 272 / ADR-0018: admin-pseudo-flag uit producten.is_pseudo
      fysiek_artikelnr: row.fysiek_artikelnr ?? null,
      omstickeren: row.omstickeren ?? false,
      fysiek_omschrijving: row.fysiek_artikelnr && fysiekOmschMap
        ? fysiekOmschMap.get(row.fysiek_artikelnr) ?? null : null,
      is_maatwerk: row.is_maatwerk ?? false,
      maatwerk_vorm: row.maatwerk_vorm ?? null,
      maatwerk_lengte_cm: row.maatwerk_lengte_cm ?? null,
      maatwerk_breedte_cm: row.maatwerk_breedte_cm ?? null,
      maatwerk_diameter_cm: row.maatwerk_diameter_cm ?? null,
      maatwerk_afwerking: row.maatwerk_afwerking ?? null,
      maatwerk_band_kleur: row.maatwerk_band_kleur ?? null,
      maatwerk_instructies: row.maatwerk_instructies ?? null,
      maatwerk_m2_prijs: row.maatwerk_m2_prijs ?? null,
      maatwerk_oppervlak_m2: row.maatwerk_oppervlak_m2 ?? null,
      maatwerk_vorm_toeslag: row.maatwerk_vorm_toeslag ?? null,
      maatwerk_afwerking_prijs: row.maatwerk_afwerking_prijs ?? null,
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

  const eigenNaamMap = await fetchKlanteigenNamenMap(debiteurNr)

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
      .select('id, snijplan_nr, status, scancode, locatie, order_regel_id')
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
          locatie: (sp as { locatie?: string | null }).locatie ?? null,
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
