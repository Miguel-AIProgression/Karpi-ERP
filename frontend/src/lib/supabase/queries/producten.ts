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
  sortBy?: ProductSortField
  sortDir?: SortDirection
}) {
  const { search, page = 0, pageSize = 50, productType, sortBy = 'artikelnr', sortDir = 'asc' } = params
  const hasSearch = Boolean(search?.trim())

  let query = supabase
    .from('producten_overzicht')
    .select('artikelnr, karpi_code, omschrijving, kwaliteit_code, kleur_code, zoeksleutel, voorraad, vrije_voorraad, verkoopprijs, actief, product_type, locatie, aantal_rollen, totaal_oppervlak_m2, totaal_waarde_rollen', { count: 'exact' })
    .eq('actief', true)
    .order(sortBy, { ascending: sortDir === 'asc' })

  if (productType && productType !== 'alle') {
    query = query.eq('product_type', productType)
  }

  if (hasSearch) {
    // Bij zoeken: geen paginering zodat client-side word-boundary filter alle kandidaten verwerkt
    query = applyProductSearch(query, search!).limit(1000)
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
