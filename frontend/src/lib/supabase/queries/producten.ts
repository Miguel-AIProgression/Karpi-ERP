import { supabase } from '../client'
import { applyProductSearch, filterProductsWordBoundary } from '@/lib/utils/sanitize'

export type ProductType = 'vast' | 'rol' | 'overig' | 'staaltje'
export type ProductSortField = 'artikelnr' | 'karpi_code' | 'omschrijving' | 'verkoopprijs' | 'voorraad' | 'vrije_voorraad' | 'aantal_rollen' | 'totaal_oppervlak_m2' | 'locatie'
export type SortDirection = 'asc' | 'desc'

export interface ProductRow {
  artikelnr: string
  karpi_code: string | null
  omschrijving: string
  kwaliteit_code: string | null
  kleur_code: string | null
  zoeksleutel: string | null
  voorraad: number
  vrije_voorraad: number
  verkoopprijs: number | null
  actief: boolean
  product_type: ProductType | null
  locatie: string | null
  aantal_rollen: number
  totaal_oppervlak_m2: number
  totaal_waarde_rollen: number
}

export interface ProductDetail extends ProductRow {
  ean_code: string | null
  vervolgomschrijving: string | null
  backorder: number
  gereserveerd: number
  besteld_inkoop: number
  inkoopprijs: number | null
  gewicht_kg: number | null
  lengte_cm: number | null
  breedte_cm: number | null
  vorm: 'rechthoek' | 'rond'
  gewicht_uit_kwaliteit: boolean
  product_type: ProductType | null
}

export interface RolRow {
  id: number
  rolnummer: string
  omschrijving: string | null
  lengte_cm: number | null
  breedte_cm: number | null
  oppervlak_m2: number | null
  vvp_m2: number | null
  waarde: number | null
  status: string
}

/** Fetch products list */
export async function fetchProducten(params: {
  search?: string
  page?: number
  pageSize?: number
  productType?: ProductType | 'alle'
  kwaliteitCode?: string | null
  sortBy?: ProductSortField
  sortDir?: SortDirection
}) {
  const { search, page = 0, pageSize = 50, productType, kwaliteitCode, sortBy = 'artikelnr', sortDir = 'asc' } = params
  const hasSearch = Boolean(search?.trim())

  let query = supabase
    .from('producten_overzicht')
    .select('artikelnr, karpi_code, omschrijving, kwaliteit_code, kleur_code, zoeksleutel, voorraad, vrije_voorraad, verkoopprijs, actief, product_type, locatie, aantal_rollen, totaal_oppervlak_m2, totaal_waarde_rollen', { count: 'exact' })
    .eq('actief', true)
    .order(sortBy, { ascending: sortDir === 'asc' })

  if (productType && productType !== 'alle') {
    query = query.eq('product_type', productType)
  }

  if (kwaliteitCode) {
    query = query.eq('kwaliteit_code', kwaliteitCode)
  }

  if (hasSearch) {
    // Bij zoeken: geen paginering zodat client-side word-boundary filter alle kandidaten verwerkt
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query = applyProductSearch(query as any, search!).limit(1000) as typeof query
  } else {
    query = query.range(page * pageSize, (page + 1) * pageSize - 1)
  }

  const { data, error, count } = await query
  if (error) throw error

  // Client-side word-boundary filter: voorkomt dat "16" matcht in "160 ROND"
  const producten = hasSearch
    ? filterProductsWordBoundary((data ?? []) as ProductRow[], search!)
    : (data ?? []) as ProductRow[]

  return { producten, totalCount: hasSearch ? producten.length : (count ?? 0) }
}

/** Fetch single product */
export async function fetchProductDetail(artikelnr: string): Promise<ProductDetail> {
  const { data, error } = await supabase
    .from('producten')
    .select('*')
    .eq('artikelnr', artikelnr)
    .single()

  if (error) throw error
  return data as ProductDetail
}

export interface LeverancierRow {
  id: number
  naam: string
}

export interface ProductFormData {
  artikelnr: string
  karpi_code?: string | null
  ean_code?: string | null
  omschrijving: string
  vervolgomschrijving?: string | null
  kwaliteit_code?: string | null
  kleur_code?: string | null
  product_type?: ProductType | null
  verkoopprijs?: number | null
  inkoopprijs?: number | null
  gewicht_kg?: number | null
  voorraad?: number
  besteld_inkoop?: number
  locatie?: string | null
  leverancier_id?: number | null
  actief?: boolean
}

/** Create a new product */
export async function createProduct(data: ProductFormData): Promise<void> {
  const zoeksleutel = data.kwaliteit_code && data.kleur_code
    ? `${data.kwaliteit_code}_${data.kleur_code}`
    : null

  const { error } = await supabase
    .from('producten')
    .insert({ ...data, zoeksleutel })

  if (error) throw error
}

/**
 * Volgend artikelnr bepalen voor een kwaliteit+kleur combinatie.
 *
 * Karpi-conventie (afgeleid uit brondata): 9-cijferig artikelnr waarvan
 * varianten van dezelfde kwaliteit+kleur sequentieel oplopen — bijv.
 * FAMU kleur 48 → 298480000, 298480001, 298480002, 298480003. Per kleur
 * is er dus een vaste basis (eerste 5 cijfers) en oplopend volgnummer.
 *
 * Strategie:
 *   1) MAX(artikelnr) binnen karpi_code-prefix `{kwaliteit}{kleur}` → +1
 *   2) Anders: MAX binnen kleurcode-range (`%{kleur}XX%`) → +1 (zelfde kleur,
 *      andere kwaliteit reuse'd dezelfde basis-prefix in praktijk)
 *   3) Anders: globale MAX(9-digit artikelnrs) + 1
 *   4) Fallback "298000000" als de tabel leeg is
 */
export async function fetchNextArtikelnr(
  kwaliteit_code: string | null,
  kleur_code: string | null,
): Promise<string> {
  const isNineDigit = (s: string) => /^\d{9}$/.test(s)
  const toMaxPlusOne = (rows: { artikelnr: string }[]): string | null => {
    const nums = rows
      .map(r => r.artikelnr)
      .filter(a => typeof a === 'string' && isNineDigit(a))
      .map(a => parseInt(a, 10))
    if (nums.length === 0) return null
    return String(Math.max(...nums) + 1).padStart(9, '0')
  }

  if (kwaliteit_code && kleur_code) {
    const prefix = `${kwaliteit_code.toUpperCase()}${kleur_code}`
    const { data } = await supabase
      .from('producten')
      .select('artikelnr')
      .ilike('karpi_code', `${prefix}%`)
      .not('artikelnr', 'is', null)
      .limit(500)

    const next = toMaxPlusOne((data ?? []) as { artikelnr: string }[])
    if (next) return next

    // Fallback: zelfde kleur, andere kwaliteit — leen de basis-prefix
    const { data: kleurData } = await supabase
      .from('producten')
      .select('artikelnr')
      .ilike('karpi_code', `____${kleur_code}XX%`)
      .not('artikelnr', 'is', null)
      .limit(500)

    const nextKleur = toMaxPlusOne((kleurData ?? []) as { artikelnr: string }[])
    if (nextKleur) return nextKleur
  }

  // Globale fallback: hoogste 9-digit artikelnr + 1
  const { data: allData } = await supabase
    .from('producten')
    .select('artikelnr')
    .not('artikelnr', 'is', null)
    .order('artikelnr', { ascending: false })
    .limit(200)

  const next = toMaxPlusOne((allData ?? []) as { artikelnr: string }[])
  return next ?? '298000000'
}

/** Update an existing product */
export async function updateProduct(artikelnr: string, data: Partial<Omit<ProductFormData, 'artikelnr'>>): Promise<void> {
  const updates: Record<string, unknown> = { ...data }

  if ('kwaliteit_code' in data || 'kleur_code' in data) {
    const { data: current } = await supabase
      .from('producten')
      .select('kwaliteit_code, kleur_code')
      .eq('artikelnr', artikelnr)
      .single()
    const kwal = data.kwaliteit_code ?? current?.kwaliteit_code
    const kleur = data.kleur_code ?? current?.kleur_code
    updates.zoeksleutel = kwal && kleur ? `${kwal}_${kleur}` : null
  }

  const { error } = await supabase
    .from('producten')
    .update(updates)
    .eq('artikelnr', artikelnr)

  if (error) throw error
}

/** Fetch all leveranciers for dropdown */
export async function fetchLeveranciers(): Promise<LeverancierRow[]> {
  const { data, error } = await supabase
    .from('leveranciers')
    .select('id, naam')
    .eq('actief', true)
    .order('naam')
  if (error) throw error
  return (data ?? []) as LeverancierRow[]
}

/** Fetch all kwaliteit codes for dropdown */
export async function fetchKwaliteiten(): Promise<{ code: string; omschrijving: string | null }[]> {
  const { data, error } = await supabase
    .from('kwaliteiten')
    .select('code, omschrijving')
    .order('code')
  if (error) throw error
  return data ?? []
}

/** Update product type */
export async function updateProductType(artikelnr: string, productType: ProductType) {
  const { error } = await supabase
    .from('producten')
    .update({ product_type: productType })
    .eq('artikelnr', artikelnr)

  if (error) throw error
}

/** Update product locatie */
export async function updateProductLocatie(artikelnr: string, locatie: string | null) {
  const { error } = await supabase
    .from('producten')
    .update({ locatie })
    .eq('artikelnr', artikelnr)

  if (error) throw error
}

/** Uitwisselbare groepen: collecties met 2+ kwaliteiten en hun kleuren */
export interface UitwisselbareKwaliteit {
  code: string
  omschrijving: string | null
  kleuren: string[]
}

export interface UitwisselbareGroep {
  collectie_id: number
  collectie_naam: string
  kwaliteiten: UitwisselbareKwaliteit[]
  gedeelde_kleuren: string[]
  niet_overeenkomende_kleuren: string[]
}

export async function fetchUitwisselbareGroepen(): Promise<UitwisselbareGroep[]> {
  // 1. Fetch collecties and kwaliteiten in parallel (independent queries)
  const [collectiesRes, kwaliteitenRes] = await Promise.all([
    supabase.from('collecties').select('id, naam').eq('actief', true).order('naam'),
    supabase.from('kwaliteiten').select('code, omschrijving, collectie_id').not('collectie_id', 'is', null).order('code'),
  ])

  if (collectiesRes.error) throw collectiesRes.error
  if (kwaliteitenRes.error) throw kwaliteitenRes.error

  const collecties = collectiesRes.data
  const kwaliteiten = kwaliteitenRes.data

  // 2. Fetch kleur_codes per kwaliteit in batches (Supabase default limit = 1000)
  const linkedCodes = kwaliteiten.map((k: { code: string }) => k.code)
  if (linkedCodes.length === 0) return []

  const producten: { kwaliteit_code: string; kleur_code: string }[] = []
  const PAGE_SIZE = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('producten')
      .select('kwaliteit_code, kleur_code')
      .in('kwaliteit_code', linkedCodes)
      .eq('actief', true)
      .not('kleur_code', 'is', null)
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw error
    if (!data || data.length === 0) break
    producten.push(...(data as { kwaliteit_code: string; kleur_code: string }[]))
    if (data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  // Build kleur sets per kwaliteit
  const kleurenPerKwaliteit = new Map<string, Set<string>>()
  for (const p of producten as { kwaliteit_code: string; kleur_code: string }[]) {
    if (!kleurenPerKwaliteit.has(p.kwaliteit_code)) {
      kleurenPerKwaliteit.set(p.kwaliteit_code, new Set())
    }
    kleurenPerKwaliteit.get(p.kwaliteit_code)!.add(p.kleur_code)
  }

  // Group kwaliteiten by collectie
  const kwalPerCollectie = new Map<number, { code: string; omschrijving: string | null }[]>()
  for (const k of kwaliteiten as { code: string; omschrijving: string | null; collectie_id: number }[]) {
    if (!kwalPerCollectie.has(k.collectie_id)) {
      kwalPerCollectie.set(k.collectie_id, [])
    }
    kwalPerCollectie.get(k.collectie_id)!.push({ code: k.code, omschrijving: k.omschrijving })
  }

  // Build groups (only collecties with 2+ kwaliteiten)
  const groepen: UitwisselbareGroep[] = []
  for (const c of collecties as { id: number; naam: string }[]) {
    const kwals = kwalPerCollectie.get(c.id)
    if (!kwals || kwals.length < 2) continue

    const kwaliteitKleuren = kwals.map((k) => ({
      ...k,
      kleuren: Array.from(kleurenPerKwaliteit.get(k.code) ?? []).sort(),
    }))

    // Calculate shared vs unique colors
    const allKleurSets = kwaliteitKleuren.map((k) => new Set(k.kleuren))
    const allKleuren = new Set(kwaliteitKleuren.flatMap((k) => k.kleuren))
    const gedeeld: string[] = []
    const nietOvereenkomend: string[] = []

    for (const kleur of allKleuren) {
      const inCount = allKleurSets.filter((s) => s.has(kleur)).length
      if (inCount >= 2) {
        gedeeld.push(kleur)
      } else {
        nietOvereenkomend.push(kleur)
      }
    }

    groepen.push({
      collectie_id: c.id,
      collectie_naam: c.naam,
      kwaliteiten: kwaliteitKleuren,
      gedeelde_kleuren: gedeeld.sort(),
      niet_overeenkomende_kleuren: nietOvereenkomend.sort(),
    })
  }

  return groepen
}

export interface ReserveringRow {
  order_id: number
  order_nr: string
  status: string
  orderdatum: string | null
  klant_naam: string | null
  te_leveren: number
  omschrijving: string | null
}

/** Fetch active reservations (order lines) for a product */
export async function fetchReserveringenVoorProduct(artikelnr: string): Promise<ReserveringRow[]> {
  // Step 1: fetch order_regels with order info (avoid debiteuren join: orders has 2 FKs to debiteuren)
  const { data, error } = await supabase
    .from('order_regels')
    .select(`
      te_leveren,
      omschrijving,
      orders!inner(id, order_nr, status, orderdatum, debiteur_nr)
    `)
    .or(`artikelnr.eq.${artikelnr},fysiek_artikelnr.eq.${artikelnr}`)
    .gt('te_leveren', 0)

  if (error) throw error

  const rows = ((data ?? []) as any[])
    .filter(r => !['Verzonden', 'Geannuleerd'].includes(r.orders?.status))

  if (rows.length === 0) return []

  // Step 2: fetch klant names for the debiteur_nrs we found
  const debiteurNrs = [...new Set(rows.map((r: any) => r.orders.debiteur_nr).filter(Boolean))]
  const { data: debiteuren } = await supabase
    .from('debiteuren')
    .select('debiteur_nr, naam')
    .in('debiteur_nr', debiteurNrs)

  const naamMap = new Map((debiteuren ?? []).map((d: any) => [d.debiteur_nr, d.naam]))

  return rows.map(r => ({
    order_id: r.orders.id,
    order_nr: r.orders.order_nr,
    status: r.orders.status,
    orderdatum: r.orders.orderdatum,
    klant_naam: naamMap.get(r.orders.debiteur_nr) ?? null,
    te_leveren: r.te_leveren,
    omschrijving: r.omschrijving,
  }))
}

export interface ProductClaimRij {
  claim_id: number
  bron: 'voorraad' | 'inkooporder_regel'
  aantal: number
  inkooporder_nr: string | null
  verwacht_datum: string | null
  order_id: number
  order_nr: string
  order_status: string
  orderdatum: string | null
  klant_naam: string | null
}

/**
 * Fetch alle actieve order_reserveringen-rijen voor een product.
 * Per claim één rij, met `bron` (voorraad / inkooporder_regel) en (als IO-claim)
 * leverancier-leverweek info. Bron-van-waarheid: tabel order_reserveringen
 * (sinds migratie 144). Niet te verwarren met de aggregaat-variant
 * `fetchReserveringenVoorProduct` die per orderregel telt.
 *
 * Twee-stap omdat PostgREST `.eq()` op nested join-kolommen niet betrouwbaar filtert.
 */
export async function fetchClaimsVoorProduct(artikelnr: string): Promise<ProductClaimRij[]> {
  // Stap 1: orderregels van dit artikel (incl. fysiek_artikelnr voor omstickeren)
  const { data: regels, error: regelsErr } = await supabase
    .from('order_regels')
    .select('id, order_id')
    .or(`artikelnr.eq.${artikelnr},fysiek_artikelnr.eq.${artikelnr}`)
  if (regelsErr) throw regelsErr
  const regelIds = (regels ?? []).map((r: { id: number }) => r.id)
  if (regelIds.length === 0) return []

  // Stap 2: actieve claims op die regels
  const { data: claims, error: claimsErr } = await supabase
    .from('order_reserveringen')
    .select(`
      id, bron, aantal, order_regel_id,
      inkooporder_regels:inkooporder_regel_id (
        inkooporders:inkooporder_id ( inkooporder_nr, verwacht_datum )
      )
    `)
    .eq('status', 'actief')
    .in('order_regel_id', regelIds)
  if (claimsErr) throw claimsErr

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const claimRows = (claims ?? []) as any[]
  if (claimRows.length === 0) return []

  // Stap 3: order-info voor de betrokken orders (uniek)
  const orderIds = [...new Set(claimRows.map(c => {
    const reg = (regels ?? []).find((r: { id: number }) => r.id === c.order_regel_id)
    return (reg as { order_id: number } | undefined)?.order_id
  }).filter((n): n is number => n != null))]

  const { data: orders } = await supabase
    .from('orders')
    .select('id, order_nr, status, orderdatum, debiteur_nr')
    .in('id', orderIds)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orderMap = new Map<number, any>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((orders ?? []) as any[]).map(o => [o.id, o]),
  )
  const regelToOrder = new Map<number, number>(
    (regels ?? []).map((r: { id: number; order_id: number }) => [r.id, r.order_id]),
  )

  // Stap 4: klant-namen
  const debiteurNrs = [...new Set(
    Array.from(orderMap.values()).map(o => o.debiteur_nr).filter((n: number | null) => n != null),
  )] as number[]
  const naamMap = new Map<number, string>()
  if (debiteurNrs.length > 0) {
    const { data: debs } = await supabase
      .from('debiteuren')
      .select('debiteur_nr, naam')
      .in('debiteur_nr', debiteurNrs)
    for (const d of (debs ?? []) as { debiteur_nr: number; naam: string }[]) {
      naamMap.set(d.debiteur_nr, d.naam)
    }
  }

  return claimRows
    .map(c => {
      const orderId = regelToOrder.get(c.order_regel_id)
      const ord = orderId != null ? orderMap.get(orderId) : null
      if (!ord || ['Verzonden', 'Geannuleerd'].includes(ord.status)) return null
      const io = c.inkooporder_regels?.inkooporders
      return {
        claim_id: c.id as number,
        bron: c.bron as 'voorraad' | 'inkooporder_regel',
        aantal: c.aantal as number,
        inkooporder_nr: io?.inkooporder_nr ?? null,
        verwacht_datum: io?.verwacht_datum ?? null,
        order_id: ord.id as number,
        order_nr: ord.order_nr as string,
        order_status: ord.status as string,
        orderdatum: ord.orderdatum as string | null,
        klant_naam: ord.debiteur_nr != null ? naamMap.get(ord.debiteur_nr) ?? null : null,
      }
    })
    .filter((r): r is ProductClaimRij => r !== null)
}

/** Fetch rollen for a product */
export async function fetchRollenVoorProduct(artikelnr: string): Promise<RolRow[]> {
  const { data, error } = await supabase
    .from('rollen')
    .select('id, rolnummer, omschrijving, lengte_cm, breedte_cm, oppervlak_m2, vvp_m2, waarde, status')
    .eq('artikelnr', artikelnr)
    .order('rolnummer')

  if (error) throw error
  return (data ?? []) as RolRow[]
}
