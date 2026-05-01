import { supabase } from '@/lib/supabase/client'

export type ZendingStatus =
  | 'Gepland'
  | 'Picken'
  | 'Ingepakt'
  | 'Klaar voor verzending'
  | 'Onderweg'
  | 'Afgeleverd'

export type HstTransportorderStatus =
  | 'Wachtrij'
  | 'Bezig'
  | 'Verstuurd'
  | 'Fout'
  | 'Geannuleerd'

export interface ZendingenFilters {
  status?: ZendingStatus
  debiteur_nr?: number
}

export interface ZendingAanmaakResult {
  id: number
  zending_nr: string
}

export interface ZendingPrintOrderRegel {
  id: number
  regelnummer: number | null
  omschrijving: string | null
  omschrijving_2: string | null
  orderaantal: number | null
  te_leveren: number | null
  gewicht_kg: number | null
  is_maatwerk: boolean | null
  maatwerk_lengte_cm: number | null
  maatwerk_breedte_cm: number | null
  maatwerk_kwaliteit_code: string | null
  maatwerk_kleur_code: string | null
  producten?: {
    ean_code: string | null
    omschrijving: string | null
    vervolgomschrijving: string | null
    gewicht_kg: number | null
  } | null
}

export interface ZendingPrintRegel {
  id: number
  order_regel_id: number | null
  artikelnr: string | null
  rol_id: number | null
  aantal: number | null
  order_regels?: ZendingPrintOrderRegel | null
}

export interface ZendingPrintSet {
  id: number
  zending_nr: string
  status: string
  vervoerder_code: string | null
  verzenddatum: string | null
  track_trace: string | null
  afl_naam: string | null
  afl_adres: string | null
  afl_postcode: string | null
  afl_plaats: string | null
  afl_land: string | null
  aantal_colli: number | null
  totaal_gewicht_kg: number | null
  opmerkingen: string | null
  created_at: string
  vervoerders?: {
    code: string
    display_naam: string
    type: string
    actief: boolean
  } | null
  orders: {
    id: number
    order_nr: string
    oud_order_nr: number | null
    klant_referentie: string | null
    orderdatum: string | null
    afleverdatum: string | null
    debiteur_nr: number
    debiteuren?: {
      naam: string | null
      gln_bedrijf: string | null
    } | null
  }
  zending_regels: ZendingPrintRegel[]
}

/**
 * Lijst-query voor de logistiek-overzichtspagina.
 *
 * V1: alleen `hst_transportorders`. Bij toekomstige Rhenus/Verhoek-vertical wordt
 * hier een tweede query toegevoegd voor `edi_berichten WHERE berichttype='verzendbericht'`.
 */
export async function fetchZendingen(filters: ZendingenFilters = {}) {
  let q = supabase
    .from('zendingen')
    .select(
      `
      id, zending_nr, status, vervoerder_code, verzenddatum, track_trace,
      afl_naam, afl_postcode, afl_plaats, afl_land,
      aantal_colli, totaal_gewicht_kg, created_at,
      orders!inner (
        id, order_nr, debiteur_nr,
        debiteuren (
          debiteur_nr, naam
        )
      ),
      hst_transportorders (
        id, status, extern_transport_order_id, extern_tracking_number, sent_at
      )
    `,
    )
    .order('id', { ascending: false })
    .limit(200)

  if (filters.status) q = q.eq('status', filters.status)
  if (filters.debiteur_nr) q = q.eq('orders.debiteur_nr', filters.debiteur_nr)

  return await q
}

/**
 * Detail-query: één zending met alle gekoppelde data.
 */
export async function fetchZendingMetTransportorders(zending_nr: string) {
  return await supabase
    .from('zendingen')
    .select(
      `
      *,
      orders!inner (
        *,
        debiteuren (
          *
        )
      ),
      zending_regels ( * ),
      hst_transportorders ( * )
    `,
    )
    .eq('zending_nr', zending_nr)
    .single()
}

export async function fetchZendingPrintSet(zending_nr: string): Promise<ZendingPrintSet> {
  const { data, error } = await supabase
    .from('zendingen')
    .select(
      `
      id, zending_nr, status, vervoerder_code, verzenddatum, track_trace,
      afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land,
      aantal_colli, totaal_gewicht_kg, opmerkingen, created_at,
      vervoerders ( code, display_naam, type, actief ),
      orders!inner (
        id, order_nr, oud_order_nr, klant_referentie, orderdatum, afleverdatum, debiteur_nr,
        debiteuren (
          naam, gln_bedrijf
        )
      ),
      zending_regels (
        id, order_regel_id, artikelnr, rol_id, aantal,
        order_regels (
          id, regelnummer, omschrijving, omschrijving_2, orderaantal, te_leveren,
          gewicht_kg, is_maatwerk, maatwerk_lengte_cm, maatwerk_breedte_cm,
          maatwerk_kwaliteit_code, maatwerk_kleur_code,
          producten!order_regels_artikelnr_fkey (
            ean_code, omschrijving, vervolgomschrijving, gewicht_kg
          )
        )
      )
    `,
    )
    .eq('zending_nr', zending_nr)
    .single()

  if (error) throw toError(error, 'Verzendset ophalen mislukt')
  return data as unknown as ZendingPrintSet
}

export async function createZendingVoorOrder(orderId: number): Promise<ZendingAanmaakResult> {
  const { data, error } = await supabase.rpc('create_zending_voor_order', {
    p_order_id: orderId,
  })
  if (error) throw toError(error, 'Zending aanmaken mislukt')

  const zendingId = readZendingId(data)
  if (!zendingId) throw new Error('Zending aangemaakt, maar response bevat geen zending-id.')

  const { data: zending, error: zErr } = await supabase
    .from('zendingen')
    .select('id, zending_nr')
    .eq('id', zendingId)
    .single()
  if (zErr) throw toError(zErr, 'Aangemaakte zending ophalen mislukt')
  if (!zending?.zending_nr) throw new Error('Zending aangemaakt, maar zending_nr ontbreekt.')

  return { id: Number(zending.id), zending_nr: zending.zending_nr }
}

function toError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error
  if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>
    const parts = [obj.message, obj.details, obj.hint, obj.code]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    if (parts.length > 0) return new Error(`${fallback}: ${parts.join(' ')}`)
  }
  return new Error(`${fallback}: ${String(error)}`)
}

function readZendingId(data: unknown): number | null {
  if (typeof data === 'number') return data
  if (typeof data === 'string' && data.trim()) return Number(data)
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    const raw = obj.zending_id ?? obj.id
    if (typeof raw === 'number') return raw
    if (typeof raw === 'string' && raw.trim()) return Number(raw)
  }
  return null
}

/**
 * Reset een Fout-rij naar Wachtrij zodat de cron 'm opnieuw oppakt.
 *
 * Edge case: als er ondertussen al een nieuwe actieve transportorder voor
 * dezelfde zending bestaat, blokkeert de unique-index `uk_hst_to_zending_actief`
 * de update. We zetten eventuele duplicate eerst op `Geannuleerd`.
 */
export async function verstuurZendingOpnieuw(transportorder_id: number) {
  const { data: huidig, error: fetchError } = await supabase
    .from('hst_transportorders')
    .select('id, zending_id')
    .eq('id', transportorder_id)
    .single()

  if (fetchError) throw fetchError

  if (huidig) {
    const { error: cancelError } = await supabase
      .from('hst_transportorders')
      .update({
        status: 'Geannuleerd',
        error_msg: 'Vervangen door retry van #' + transportorder_id,
      })
      .eq('zending_id', huidig.zending_id)
      .neq('id', transportorder_id)
      .in('status', ['Wachtrij', 'Bezig', 'Verstuurd'])

    if (cancelError) throw cancelError
  }

  return await supabase
    .from('hst_transportorders')
    .update({ status: 'Wachtrij', error_msg: null, retry_count: 0 })
    .eq('id', transportorder_id)
}
