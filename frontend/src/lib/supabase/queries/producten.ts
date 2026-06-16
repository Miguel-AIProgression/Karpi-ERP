import { supabase } from '../client'
import { applyProductSearch, filterProductsWordBoundary } from '@/lib/utils/sanitize'

export type ProductType = 'vast' | 'rol' | 'overig' | 'staaltje'
export type ProductSortField = 'artikelnr' | 'karpi_code' | 'omschrijving' | 'verkoopprijs' | 'voorraad' | 'vrije_voorraad' | 'aantal_rollen' | 'totaal_oppervlak_m2' | 'locatie'
export type SortDirection = 'asc' | 'desc'

export type VormCode = 'rond' | 'ovaal' | 'organisch_a' | 'pebble'

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
  maatwerk_vorm_code: VormCode | null
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
  vormCode?: VormCode | 'rechthoek' | 'alle'
  kwaliteitCode?: string | null
  sortBy?: ProductSortField
  sortDir?: SortDirection
}) {
  const { search, page = 0, pageSize = 50, productType, vormCode, kwaliteitCode, sortBy = 'artikelnr', sortDir = 'asc' } = params
  const hasSearch = Boolean(search?.trim())

  let query = supabase
    .from('producten_overzicht')
    .select('artikelnr, karpi_code, omschrijving, kwaliteit_code, kleur_code, zoeksleutel, voorraad, vrije_voorraad, verkoopprijs, actief, product_type, locatie, aantal_rollen, totaal_oppervlak_m2, totaal_waarde_rollen, maatwerk_vorm_code', { count: 'exact' })
    .eq('actief', true)
    .order(sortBy, { ascending: sortDir === 'asc' })

  if (productType && productType !== 'alle') {
    query = query.eq('product_type', productType)
  }

  if (vormCode && vormCode !== 'alle') {
    if (vormCode === 'rechthoek') {
      query = query.is('maatwerk_vorm_code', null)
    } else {
      query = query.eq('maatwerk_vorm_code', vormCode)
    }
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
  maatwerk_vorm_code?: string | null
  verkoopprijs?: number | null
  inkoopprijs?: number | null
  gewicht_kg?: number | null
  voorraad?: number
  besteld_inkoop?: number
  locatie?: string | null
  leverancier_id?: number | null
  actief?: boolean
}

/** Haal alle unieke vormen op uit de database (dynamisch, incl. toekomstige) */
export async function fetchDistincteVormen(): Promise<string[]> {
  const { data, error } = await supabase
    .from('producten')
    .select('maatwerk_vorm_code')
    .eq('actief', true)
    .not('maatwerk_vorm_code', 'is', null)
    .order('maatwerk_vorm_code')
  if (error) throw error
  const uniek = [...new Set((data ?? []).map(r => r.maatwerk_vorm_code as string))]
  return uniek
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

/** Controleer of een kwaliteitscode al bestaat in de database (duplicate-guard). */
export async function fetchKwaliteitBestaat(code: string): Promise<boolean> {
  if (!code.trim()) return false
  const { data, error } = await supabase
    .from('kwaliteiten')
    .select('code')
    .eq('code', code.trim().toUpperCase())
    .maybeSingle()
  if (error) throw error
  return data !== null
}

/** Beschikbare kleur_codes voor een kwaliteit (op basis van actieve producten). */
export async function fetchKleurenVoorKwaliteit(kwaliteitCode: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('producten')
    .select('kleur_code')
    .eq('kwaliteit_code', kwaliteitCode)
    .eq('actief', true)
    .not('kleur_code', 'is', null)
  if (error) throw error
  const set = new Set<string>()
  for (const row of (data ?? []) as { kleur_code: string }[]) {
    set.add(row.kleur_code)
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b))
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
 * Relationeel SQL via RPC `claims_voor_product` (mig 236) — één round-trip.
 */
export async function fetchClaimsVoorProduct(artikelnr: string): Promise<ProductClaimRij[]> {
  const { data, error } = await supabase.rpc('claims_voor_product', { p_artikelnr: artikelnr })
  if (error) throw error
  return (data ?? []) as ProductClaimRij[]
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
