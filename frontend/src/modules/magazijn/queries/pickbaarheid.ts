import { supabase } from '@/lib/supabase/client'
import { SHIPPING_PRODUCT_ID } from '@/lib/constants/shipping'
import { werkdagMinN } from '@/lib/utils/bereken-agenda'
import type { BucketKey, PickShipOrder } from '../lib/types'
import {
  chunks,
  comparePickShipOrders,
  filterPickShipOrders,
  initPickShipOrders,
  mapPickbaarheidRegel,
  type OrderHeaderRij,
  type PickbaarheidRij,
} from './pick-ship-transform'

/** ISO YYYY-MM-DD voor een Date, in lokale tijd. */
function isoLokaal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface FallbackOrderRegelRij {
  id: number
  order_id: number
  regelnummer: number
  artikelnr: string | null
  is_maatwerk: boolean | null
  orderaantal: number | null
  maatwerk_lengte_cm: number | null
  maatwerk_breedte_cm: number | null
  omschrijving: string | null
  maatwerk_kwaliteit_code: string | null
  maatwerk_kleur_code: string | null
}

export interface PickShipParams {
  bucket?: BucketKey
  search?: string
  vandaag?: Date
  /** Default false: toon alle open orders. Zet true voor alleen orders met >=1 pickbare regel. */
  alleen_pickbaar?: boolean
}

export interface PickShipStats {
  totaal_orders: number
  totaal_stuks: number
  totaal_m2: number
  per_bucket: Record<BucketKey, number>
}

export async function fetchPickShipOrders(
  params: PickShipParams = {}
): Promise<PickShipOrder[]> {
  const { search, bucket, vandaag = new Date(), alleen_pickbaar = false } = params

  const headers = await fetchOpenOrderHeaders()
  if (headers.length === 0) return []

  const perOrder = initPickShipOrders(headers, vandaag)
  const headerMap = new Map(headers.map((h) => [h.id, h]))
  const regels = await fetchPickbaarheidRegels(headers.map((h) => h.id))
  const karpiNamen = await fetchKarpiNamenVoorArtikelen(regels.map((r) => r.artikelnr))
  const gewichtPerOrder = await fetchTotaalGewichtPerOrder(headers.map((h) => h.id))
  const actievePickrondes = await fetchActievePickrondes(headers.map((h) => h.id))

  for (const [orderId, ronde] of actievePickrondes) {
    const order = perOrder.get(orderId)
    if (order) order.actieve_pickronde = ronde
  }

  for (const r of regels) {
    const h = headerMap.get(r.order_id)
    const order = perOrder.get(r.order_id)
    if (!h || !order) continue

    const karpiNaam = r.artikelnr ? karpiNamen.get(r.artikelnr) ?? null : null
    const regel = mapPickbaarheidRegel(r, karpiNaam)
    order.regels.push(regel)
    order.totaal_m2 = Math.round((order.totaal_m2 + regel.m2) * 100) / 100
    order.aantal_regels = order.regels.length
  }

  for (const [orderId, kg] of gewichtPerOrder) {
    const order = perOrder.get(orderId)
    if (order) order.totaal_gewicht_kg = kg
  }

  let result = Array.from(perOrder.values())
  if (alleen_pickbaar) {
    result = result.filter((o) => o.regels.some((r) => r.is_pickbaar))
  }
  // Pickbaarheidsfilter: een order verschijnt pas in Pick & Ship zodra al haar
  // regels gepickt kunnen worden. Reden voor onpickbaar maakt niet uit —
  // 'wacht op snijden', 'wacht op inkoop', 'wacht op confectie/inpak', of
  // helemaal geen regels (header-only). Uitzondering: klanten met
  // `deelleveringen_toegestaan=true` zien een order al wél zodra ≥1 regel
  // pickbaar is; de operator stuurt dan een deellevering. Orders zonder
  // enkele pickbare regel verdwijnen altijd, ook bij deelleveringen.
  //
  // Dag-orders (ADR 0014 / mig 244 lever_type='datum'): extra horizon-check.
  // Order verschijnt pas vanaf werkdagMinN(afleverdatum, 1) — d.w.z. 1 werkdag
  // vóór de afleverdatum. Voorkomt dat een dag-belofte te vroeg gepickt en
  // weggezet wordt waardoor 'm op de echte pickdag vergeten kan worden.
  const vandaagIso = isoLokaal(vandaag)
  result = result.filter((o) => {
    const header = headerMap.get(o.order_id)
    // Bewuste keuze (2026-06-04): een onbevestigde EDI-leverweek (mig 309/310)
    // BLOKKEERT Pick & Ship NIET. De order moet hoe dan ook geleverd worden;
    // de leverweek-bevestiging is een administratieve toezegging richting de
    // klant (orderbev draagt de bevestigde week), géén magazijn-poort. De
    // operator ziet de order dus gewoon als pickbaar; de "Te bevestigen"-chip
    // op orders-overzicht + de EdiLeverweekBevestigen-widget op order-detail
    // blijven de bevestiging aansturen. (isLeverweekTeBevestigen wordt hier
    // daarom NIET meer als filter gebruikt.)
    if (o.regels.length === 0) return false
    const allesPickbaar = o.regels.every((r) => r.is_pickbaar)
    if (header?.lever_type === 'datum' && header.afleverdatum) {
      const horizon = werkdagMinN(header.afleverdatum, 1)
      if (vandaagIso < horizon) return false
    }
    if (allesPickbaar) return true
    if (!header?.deelleveringen_toegestaan) return false
    return o.regels.some((r) => r.is_pickbaar)
  })
  if (search) result = filterPickShipOrders(result, search)
  if (bucket) result = result.filter((o) => o.bucket === bucket)
  result.sort(comparePickShipOrders)
  return result
}

async function fetchOpenOrderHeaders(): Promise<OrderHeaderRij[]> {
  const { data: ordersRaw, error } = await supabase
    .from('orders')
    .select(
      'id, order_nr, status, debiteur_nr, afl_naam, afl_adres, afl_postcode, ' +
        'afl_plaats, afl_land, afleverdatum, afhalen, lever_type, bron_systeem, edi_bevestigd_op'
    )
    .neq('status', 'Verzonden')
    .neq('status', 'Geannuleerd')
    // R1: productie-only orders horen niet in Pick & Ship (afhandeling in Basta)
    .eq('alleen_productie', false)
    .order('afleverdatum', { ascending: true })
    .order('order_nr', { ascending: true })

  if (error) throw error

  const ordersBase = (ordersRaw ?? []) as unknown as Array<
    Omit<OrderHeaderRij, 'klant_naam' | 'deelleveringen_toegestaan'>
  >
  // Filter NULL/ongeldige debiteur_nrs eruit: orders zonder klant (bv. e-mail-
  // Concept-orders, ORD-2026-0094/0095) hebben debiteur_nr=NULL. Zonder deze
  // guard belandt een lege waarde in de `.in('debiteur_nr', [...])`-lijst →
  // PostgREST 400 "invalid input syntax for type integer" → fetchOpenOrderHeaders
  // faalt → de hele Pick & Ship-pagina valt leeg ("Geen open orders").
  const debiteurNrs = Array.from(
    new Set(ordersBase.map((o) => o.debiteur_nr).filter((nr): nr is number => nr != null))
  )
  const klantMap = new Map<number, { naam: string; deelleveringen_toegestaan: boolean }>()

  if (debiteurNrs.length > 0) {
    const { data: debs, error: derr } = await supabase
      .from('debiteuren')
      .select('debiteur_nr, naam, deelleveringen_toegestaan')
      .in('debiteur_nr', debiteurNrs)
    if (derr) throw derr

    for (const d of (debs ?? []) as Array<{
      debiteur_nr: number
      naam: string
      deelleveringen_toegestaan: boolean | null
    }>) {
      klantMap.set(d.debiteur_nr, {
        naam: d.naam,
        deelleveringen_toegestaan: d.deelleveringen_toegestaan ?? false,
      })
    }
  }

  return ordersBase.map((o) => {
    const klant = klantMap.get(o.debiteur_nr)
    return {
      ...o,
      klant_naam: klant?.naam ?? null,
      deelleveringen_toegestaan: klant?.deelleveringen_toegestaan ?? false,
    }
  })
}

async function fetchPickbaarheidRegels(orderIds: number[]): Promise<PickbaarheidRij[]> {
  // Gechunkt op order_id — een kale GET op de hele view loopt tegen de
  // PostgREST max-rows-cap (1000 rijen) aan. Met >1000 view-rijen (EDI-instroom
  // juni 2026: 2068) kregen orders buiten de eerste 1000 rijen géén regels,
  // waardoor `regels.length === 0` ze stilletjes uit Pick & Ship filterde
  // (91 zichtbaar van ~236 pickbare orders).
  const rows: PickbaarheidRij[] = []
  for (const ids of chunks(orderIds, 100)) {
    const { data, error } = await supabase
      .from('orderregel_pickbaarheid')
      .select(
        'order_regel_id, order_id, regelnummer, artikelnr, is_maatwerk, ' +
          'orderaantal, maatwerk_lengte_cm, maatwerk_breedte_cm, omschrijving, ' +
          'maatwerk_kwaliteit_code, maatwerk_kleur_code, totaal_stuks, ' +
          'pickbaar_stuks, is_pickbaar, bron, fysieke_locatie, wacht_op'
      )
      .in('order_id', ids)
      // Specifieke VERZEND-skip voor pakbon-/pick-listing: verzendkosten zijn
      // factuurregels, geen fysiek collo. Andere admin-pseudo's (BUNDELKORTING/
      // DREMPELKORTING) bestaan niet als orderregel in productie (mig 262).
      // Voor generieke admin-pseudo-skip: zie ADR-0018 / isAdminPseudo(regel).
      .neq('artikelnr', SHIPPING_PRODUCT_ID)

    if (error) {
      if (isMissingPickbaarheidViewError(error)) return fetchFallbackOrderRegels(orderIds)
      throw error
    }
    rows.push(...((data ?? []) as unknown as PickbaarheidRij[]))
  }
  return rows
}

async function fetchFallbackOrderRegels(orderIds: number[]): Promise<PickbaarheidRij[]> {
  const rows: FallbackOrderRegelRij[] = []

  for (const ids of chunks(orderIds, 100)) {
    const { data, error } = await supabase
      .from('order_regels')
      .select(
        'id, order_id, regelnummer, artikelnr, is_maatwerk, orderaantal, ' +
          'maatwerk_lengte_cm, maatwerk_breedte_cm, omschrijving, ' +
          'maatwerk_kwaliteit_code, maatwerk_kleur_code'
      )
      .in('order_id', ids)
      // Specifieke VERZEND-skip — zie pakbon-listing-comment hierboven (ADR-0018).
      .neq('artikelnr', SHIPPING_PRODUCT_ID)
      .order('regelnummer', { ascending: true })

    if (error) throw error
    rows.push(...((data ?? []) as unknown as FallbackOrderRegelRij[]))
  }

  return rows.map((r) => ({
    order_regel_id: r.id,
    order_id: r.order_id,
    regelnummer: r.regelnummer,
    artikelnr: r.artikelnr,
    is_maatwerk: r.is_maatwerk ?? false,
    orderaantal: r.orderaantal ?? 0,
    maatwerk_lengte_cm: r.maatwerk_lengte_cm,
    maatwerk_breedte_cm: r.maatwerk_breedte_cm,
    omschrijving: r.omschrijving,
    maatwerk_kwaliteit_code: r.maatwerk_kwaliteit_code,
    maatwerk_kleur_code: r.maatwerk_kleur_code,
    totaal_stuks: null,
    pickbaar_stuks: null,
    is_pickbaar: false,
    bron: null,
    fysieke_locatie: null,
    wacht_op: null,
  }))
}

/**
 * Som `gewicht_kg × orderaantal` per order. Pseudo-regel `VERZEND` wordt
 * uitgesloten — die is een factuurregel, geen fysiek collo (zie mig 206).
 * Wordt indicatief getoond op Pick & Ship; definitief gewicht wordt later door
 * `create_zending_voor_order` op de zending gezet.
 */
/**
 * Per order: de actieve Pickronde (zending in 'Picken'-status), inclusief
 * picker-naam. Bron is `zending_orders` M2M (mig 222, canoniek vanaf mig 242
 * dankzij AFTER-INSERT-trigger + backfill) — niet `zendingen.order_id`, want
 * bij bundel-zendingen verwijst die alleen naar de "primaire" order en zouden
 * de overige bundel-leden ten onrechte als "niet in pickronde" gelden.
 * Twee aparte queries (zending_orders → medewerkers) ipv geneste FK-embed,
 * consistent met de pré-mig-242 stijl en eenvoudiger te debuggen.
 */
async function fetchActievePickrondes(
  orderIds: number[]
): Promise<Map<number, import('../lib/types').ActievePickronde>> {
  const map = new Map<number, import('../lib/types').ActievePickronde>()
  if (orderIds.length === 0) return map

  // Stap 1: koppelingen + zending-details ophalen via zending_orders M2M.
  // INNER-embed filtert non-Picken-zendingen al SQL-zijde weg.
  const zendingen: Array<{
    id: number
    zending_nr: string
    order_id: number
    picker_id: number | null
  }> = []

  for (const ids of chunks(orderIds, 100)) {
    const { data, error } = await supabase
      .from('zending_orders')
      .select('order_id, zendingen!inner(id, zending_nr, picker_id, status)')
      .in('order_id', ids)
      .eq('zendingen.status', 'Picken')
    if (error) {
      console.error('[pickbaarheid] fetchActievePickrondes zending_orders-query error', error)
      throw error
    }
    for (const row of (data ?? []) as unknown as Array<{
      order_id: number
      zendingen: { id: number; zending_nr: string; picker_id: number | null; status: string } | null
    }>) {
      if (!row.zendingen) continue
      zendingen.push({
        id: row.zendingen.id,
        zending_nr: row.zendingen.zending_nr,
        order_id: row.order_id,
        picker_id: row.zendingen.picker_id,
      })
    }
  }

  if (zendingen.length === 0) return map

  // Stap 2: picker-namen ophalen via medewerkers (alleen unieke ids)
  const pickerIds = Array.from(
    new Set(zendingen.map((z) => z.picker_id).filter((id): id is number => id != null))
  )
  const naamMap = new Map<number, string>()
  if (pickerIds.length > 0) {
    const { data: medewerkers, error: mErr } = await supabase
      .from('medewerkers')
      .select('id, naam')
      .in('id', pickerIds)
    if (mErr) {
      console.warn('[pickbaarheid] medewerkers-naam-fetch faalde', mErr)
    } else {
      for (const m of (medewerkers ?? []) as Array<{ id: number; naam: string }>) {
        naamMap.set(m.id, m.naam)
      }
    }
  }

  // Bij meerdere Picken-zendingen voor één order: laatste wint (per insert-volgorde).
  for (const z of zendingen) {
    map.set(z.order_id, {
      zending_id: z.id,
      zending_nr: z.zending_nr,
      picker_id: z.picker_id,
      picker_naam: z.picker_id != null ? naamMap.get(z.picker_id) ?? null : null,
    })
  }

  if (process.env.NODE_ENV === 'development') {
    console.debug('[pickbaarheid] actieve pickrondes:', map.size, 'voor', orderIds.length, 'orders')
  }

  return map
}

async function fetchTotaalGewichtPerOrder(orderIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>()
  if (orderIds.length === 0) return map

  for (const ids of chunks(orderIds, 100)) {
    const { data, error } = await supabase
      .from('order_regels')
      .select('order_id, gewicht_kg, orderaantal, artikelnr')
      .in('order_id', ids)
      // VERZEND telt niet in zending-gewicht (factuurregel, geen collo). ADR-0018.
      .neq('artikelnr', SHIPPING_PRODUCT_ID)
    if (error) throw error
    for (const row of (data ?? []) as Array<{
      order_id: number
      gewicht_kg: number | null
      orderaantal: number | null
    }>) {
      const kg = (row.gewicht_kg ?? 0) * (row.orderaantal ?? 0)
      map.set(row.order_id, (map.get(row.order_id) ?? 0) + kg)
    }
  }

  for (const [k, v] of map) map.set(k, Math.round(v * 100) / 100)
  return map
}

/**
 * Haalt Karpi-product-omschrijving op voor de gegeven artikelen. Wordt gebruikt
 * op de Pick & Ship-pagina zodat het magazijn altijd de canonische Karpi-naam
 * uit `producten.omschrijving` ziet — niet de klanteigen-naam die in
 * `order_regels.omschrijving` is weggeschreven (mig 200). Pakbon en
 * verzendsticker tonen wél beide namen voor de klant.
 */
async function fetchKarpiNamenVoorArtikelen(
  artikelnrs: Array<string | null>
): Promise<Map<string, string>> {
  const uniek = Array.from(new Set(artikelnrs.filter((a): a is string => !!a)))
  const map = new Map<string, string>()
  if (uniek.length === 0) return map

  for (const ids of chunks(uniek, 200)) {
    const { data, error } = await supabase
      .from('producten')
      .select('artikelnr, omschrijving')
      .in('artikelnr', ids)
    if (error) throw error
    for (const row of (data ?? []) as Array<{ artikelnr: string; omschrijving: string | null }>) {
      if (row.omschrijving) map.set(row.artikelnr, row.omschrijving)
    }
  }
  return map
}

function isMissingPickbaarheidViewError(error: { code?: string; message?: string }): boolean {
  return (
    error.code === 'PGRST205' ||
    (error.message ?? '').includes("Could not find the table 'public.orderregel_pickbaarheid'")
  )
}

export async function fetchPickShipStats(vandaag: Date = new Date()): Promise<PickShipStats> {
  const orders = await fetchPickShipOrders({ vandaag })
  const stats: PickShipStats = {
    totaal_orders: orders.length,
    totaal_stuks: orders.reduce((s, o) => s + o.aantal_regels, 0),
    totaal_m2: Math.round(orders.reduce((s, o) => s + o.totaal_m2, 0) * 100) / 100,
    per_bucket: { wk_1: 0, wk_2: 0, wk_3: 0, wk_4: 0, wk_5: 0, later: 0 },
  }
  for (const o of orders) stats.per_bucket[o.bucket] += 1
  return stats
}

// Atomaire vervanger van `createOrGetMagazijnLocatie + UPDATE snijplannen`.
// Zie migratie 0183 + ADR-0002.
export async function setLocatieVoorOrderregel(
  orderRegelId: number,
  locatieCode: string
): Promise<number> {
  const { data, error } = await supabase.rpc('set_locatie_voor_orderregel', {
    p_order_regel_id: orderRegelId,
    p_code: locatieCode,
  })
  if (error) throw error
  return data as number
}

export async function updateRolLocatieVoorArtikel(
  artikelnr: string,
  magazijnLocatieId: number
): Promise<void> {
  const { data, error: selErr } = await supabase
    .from('rollen')
    .select('id')
    .eq('artikelnr', artikelnr)
    .eq('status', 'beschikbaar')
    .order('id', { ascending: true })
    .limit(1)
  if (selErr) throw selErr
  const rolId = (data?.[0] as { id: number } | undefined)?.id
  if (!rolId) throw new Error(`Geen beschikbare rol voor artikel ${artikelnr}`)
  const { error } = await supabase
    .from('rollen')
    .update({ locatie_id: magazijnLocatieId })
    .eq('id', rolId)
  if (error) throw error
}
