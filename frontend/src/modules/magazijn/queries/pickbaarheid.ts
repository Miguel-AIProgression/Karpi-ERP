import { supabase } from '@/lib/supabase/client'
import { werkdagMinN } from '@/lib/utils/bereken-agenda'
import type { BucketKey, PickShipOrder } from '../lib/types'
import {
  chunks,
  comparePickShipOrders,
  filterPickShipOrders,
  initPickShipOrders,
  mapPickbaarheidRegel,
  type OrderHeaderRij,
  type OrderPickbaarheidRij,
  type PickbaarheidRij,
} from './pick-ship-transform'

/** ISO YYYY-MM-DD voor een Date, in lokale tijd. */
function isoLokaal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
  const orderPickbaarheid = await fetchOrderPickbaarheid(headers.map((h) => h.id))
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
    order.totaal_gewicht_kg =
      Math.round((order.totaal_gewicht_kg + (r.gewicht_kg ?? 0) * (r.orderaantal ?? 0)) * 100) / 100
    order.aantal_regels = order.regels.length
  }

  for (const [orderId, opb] of orderPickbaarheid) {
    const order = perOrder.get(orderId)
    if (order) order.alle_regels_pickbaar = opb.alle_regels_pickbaar
  }

  let result = Array.from(perOrder.values())
  if (alleen_pickbaar) {
    result = result.filter((o) => orderPickbaarheid.get(o.order_id)?.heeft_pickbare_regel ?? false)
  }
  // Pickbaarheids-gate: het order-niveau-predicaat (alle regels pickbaar, of
  // ≥1 pickbare regel als de klant deelleveringen toestaat, en überhaupt
  // regels) komt sinds mig 383 volledig uit view `order_pickbaarheid`
  // (pick_ship_zichtbaar) — de view skipt ook admin-pseudo-regels (ADR-0018).
  // TS filtert hier alleen nog. Enige client-side uitzondering: de dag-order-
  // horizon (ADR 0014 / mig 244), omdat die van `vandaag` afhangt — een
  // dag-order verschijnt pas vanaf werkdagMinN(afleverdatum, 1).
  // NB de bewuste keuze van 2026-06-04 blijft staan: een onbevestigde
  // EDI-leverweek (mig 309/316) blokkeert Pick & Ship NIET.
  const vandaagIso = isoLokaal(vandaag)
  result = result.filter((o) => {
    const opb = orderPickbaarheid.get(o.order_id)
    if (!opb) return false // geen (niet-pseudo) regels → niets te picken
    const header = headerMap.get(o.order_id)
    if (header?.lever_type === 'datum' && header.afleverdatum) {
      const horizon = werkdagMinN(header.afleverdatum, 1)
      if (vandaagIso < horizon) return false
    }
    return opb.pick_ship_zichtbaar
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

  const ordersBase = (ordersRaw ?? []) as unknown as Array<Omit<OrderHeaderRij, 'klant_naam'>>
  // Filter NULL/ongeldige debiteur_nrs eruit: orders zonder klant (bv. e-mail-
  // Concept-orders, ORD-2026-0094/0095) hebben debiteur_nr=NULL. Zonder deze
  // guard belandt een lege waarde in de `.in('debiteur_nr', [...])`-lijst →
  // PostgREST 400 "invalid input syntax for type integer" → fetchOpenOrderHeaders
  // faalt → de hele Pick & Ship-pagina valt leeg ("Geen open orders").
  const debiteurNrs = Array.from(
    new Set(ordersBase.map((o) => o.debiteur_nr).filter((nr): nr is number => nr != null))
  )
  const klantMap = new Map<number, string>()

  if (debiteurNrs.length > 0) {
    const { data: debs, error: derr } = await supabase
      .from('debiteuren')
      .select('debiteur_nr, naam')
      .in('debiteur_nr', debiteurNrs)
    if (derr) throw derr
    for (const d of (debs ?? []) as Array<{ debiteur_nr: number; naam: string }>) {
      klantMap.set(d.debiteur_nr, d.naam)
    }
  }

  return ordersBase.map((o) => ({
    ...o,
    klant_naam: klantMap.get(o.debiteur_nr) ?? null,
  }))
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
          'pickbaar_stuks, is_pickbaar, bron, fysieke_locatie, wacht_op, gewicht_kg'
      )
      .in('order_id', ids)

    if (error) throw error
    rows.push(...((data ?? []) as unknown as PickbaarheidRij[]))
  }
  return rows
}

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

async function fetchOrderPickbaarheid(
  orderIds: number[]
): Promise<Map<number, OrderPickbaarheidRij>> {
  const map = new Map<number, OrderPickbaarheidRij>()
  // Gechunkt per order_id — zelfde PostgREST-max-rows-cap-reden als fetchPickbaarheidRegels
  // (1 rij per order, maar >1000 open orders is realistisch met EDI-instroom).
  for (const ids of chunks(orderIds, 100)) {
    const { data, error } = await supabase
      .from('order_pickbaarheid')
      .select(
        'order_id, totaal_regels, pickbare_regels, alle_regels_pickbaar, ' +
          'heeft_pickbare_regel, deelleveringen_toegestaan, pick_ship_zichtbaar'
      )
      .in('order_id', ids)
    if (error) throw error
    for (const row of (data ?? []) as unknown as OrderPickbaarheidRij[]) {
      map.set(row.order_id, row)
    }
  }
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
