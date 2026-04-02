import { supabase } from '../client'
import { sanitizeSearch } from '@/lib/utils/sanitize'

export type ProductType = 'vast' | 'rol' | 'overig' | 'staaltje'
export type ProductSortField = 'artikelnr' | 'karpi_code' | 'omschrijving' | 'verkoopprijs' | 'voorraad' | 'vrije_voorraad' | 'aantal_rollen' | 'totaal_oppervlak_m2'
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

  let query = supabase
    .from('producten_overzicht')
    .select('artikelnr, karpi_code, omschrijving, kwaliteit_code, kleur_code, zoeksleutel, voorraad, vrije_voorraad, verkoopprijs, actief, product_type, aantal_rollen, totaal_oppervlak_m2, totaal_waarde_rollen', { count: 'exact' })
    .eq('actief', true)
    .order(sortBy, { ascending: sortDir === 'asc' })
    .range(page * pageSize, (page + 1) * pageSize - 1)

  if (productType && productType !== 'alle') {
    query = query.eq('product_type', productType)
  }

  if (search) {
    const s = sanitizeSearch(search)
    if (s) {
      query = query.or(
        `artikelnr.ilike.%${s}%,karpi_code.ilike.%${s}%,omschrijving.ilike.%${s}%,zoeksleutel.ilike.%${s}%`
      )
    }
  }

  const { data, error, count } = await query
  if (error) throw error

  return { producten: (data ?? []) as ProductRow[], totalCount: count ?? 0 }
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
