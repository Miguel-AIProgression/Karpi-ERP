import { supabase } from '@/lib/supabase/client'

export type ZendingStatus =
  | 'Gepland'
  | 'Picken'
  | 'Ingepakt'
  | 'Klaar voor verzending'
  | 'Onderweg'
  | 'Afgeleverd'
  | 'Afgehaald'

export type HstTransportorderStatus =
  | 'Wachtrij'
  | 'Bezig'
  | 'Verstuurd'
  | 'Fout'
  | 'Geannuleerd'

export interface ZendingenFilters {
  status?: ZendingStatus
  debiteur_nr?: number
  /** Default true: verberg status='Picken' (lopende pickrondes). */
  exclude_picken?: boolean
}

export interface ZendingAanmaakResult {
  id: number
  zending_nr: string
  vervoerder_code: string | null
  aantal_regels: number
  is_nieuw: boolean
}

export interface ZendingPrintOrderRegel {
  id: number
  /** Mig 222: bron-order voor groepering in pakbon bij bundel-zendingen. */
  order_id: number
  regelnummer: number | null
  /** Bron-artikelnr op de orderregel. Nodig om VERZEND-regels te filteren bij
   *  oude zendingen waar `zending_regels.artikelnr` leeg is gebleven. */
  artikelnr: string | null
  omschrijving: string | null
  omschrijving_2: string | null
  orderaantal: number | null
  te_leveren: number | null
  gewicht_kg: number | null
  is_maatwerk: boolean | null
  maatwerk_lengte_cm: number | null
  maatwerk_breedte_cm: number | null
  maatwerk_afwerking: string | null
  /** Gekozen bandkleur-snapshot — alleen relevant (en getoond) bij Breedband. */
  maatwerk_band_kleur: string | null
  maatwerk_kwaliteit_code: string | null
  maatwerk_kleur_code: string | null
  maatwerk_oppervlak_m2: number | null
  producten?: {
    ean_code: string | null
    omschrijving: string | null
    vervolgomschrijving: string | null
    gewicht_kg: number | null
    lengte_cm: number | null
    breedte_cm: number | null
    vorm: string | null
    /** Kleurnummer ("10") — verzendlabel toont dit tussen haakjes achter de
     *  kwaliteitsnaam ("GALAXY (10) …", besluit 2026-06-18). Schoon, puur
     *  numeriek; `producten.vorm` (rechthoek/rond) dekt de uitvoering NIET. */
    kleur_code: string | null
    /** Volledige Karpi-code (kwaliteit+kleur+afmeting) — verzendlabel toont deze
     *  als kleine regel onder de kwaliteitsnaam (besluit 2026-06-18). */
    karpi_code: string | null
    /** Magazijnlocatie ("A.01.L") — verzendlabel toont de kale code zodat de
     *  picker weet waar het karpet ligt (verzoek 2026-06-19). Live veld (geen
     *  snapshot); leeg/NULL → niet tonen. */
    locatie: string | null
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

/**
 * Mig 222: een gebundelde zending bevat orders uit `zending_orders` M2M. Voor
 * de pakbon hebben we per extra order alleen de identificerende velden nodig
 * (order_nr + uw-referentie + week) — het gros van het document komt uit de
 * primaire order (factuuradres, vertegenwoordiger, etc., gelijk over orders
 * van dezelfde debiteur).
 */
export interface ZendingPrintBundelOrder {
  id: number
  order_nr: string
  klant_referentie: string | null
  week: string | null
}

/**
 * Eén fysieke colli uit `zending_colli` (mig 209). De `sscc` hier is exact de
 * barcode die `hst-send` als `BarCode` bij de vervoerder aanmeldt — geprinte
 * labels MOETEN deze waarde tonen en mogen nooit zelf een SSCC genereren
 * (HST-overlossing-incident 12-06-2026: label en aanmelding liepen uiteen).
 */
export interface ZendingPrintColli {
  id: number
  colli_nr: number
  sscc: string
  order_regel_id: number | null
  /** Mig 209: bevroren Karpi-product + maat ("Egyptische Wol 240x330 cm").
   *  Exact wat HST/Verhoek als GoodsDescription/Omschrijving meekrijgen. */
  omschrijving_snapshot: string | null
  /** Mig 388: bevroren, ontdubbelde klant-omschrijving (order_regels.omschrijving
   *  + _2). Single source voor de klant-naam op label/pakbon — niet meer live. */
  klant_omschrijving_snapshot: string | null
  /** Mig 420: zelf-FK naar de bundel-rij. NOT NULL = dit colli zit in een bundel
   *  en valt uit labels/carrier-bericht. */
  bundel_colli_id: number | null
  /** Mig 420: TRUE = synthetische bundel-rij (eigen SSCC, "BUNDEL — N colli"). */
  is_bundel: boolean
  /** Mig 419: klant-eigennaam voor de kwaliteit (bv. "BREDA"), bevroren via
   *  resolve_klanteigen_naam. null = geen afwijkende naam → geen "Uw referentie"-regel. */
  klanteigen_naam_snapshot: string | null
  /** Mig 436: karpi_code van het fysiek gepakte (omgesticker) equivalent als dat
   *  afwijkt van het bestelde artikel. null = geen omsticker → geen "OMB:"-regel. */
  omsticker_snapshot: string | null
}

export interface ZendingPrintSet {
  id: number
  zending_nr: string
  status: string
  vervoerder_code: string | null
  service_code: string | null
  verzenddatum: string | null
  track_trace: string | null
  afl_naam: string | null
  afl_adres: string | null
  afl_postcode: string | null
  afl_plaats: string | null
  afl_land: string | null
  /** Mig 339: leveringstelefoonnummer-snapshot — pakbon toont 'm onder het afleveradres. */
  afl_telefoon: string | null
  /** Mig 473: TRUE = deze zending dekt niet de hele order (deelzending). */
  is_deelzending?: boolean | null
  aantal_colli: number | null
  totaal_gewicht_kg: number | null
  opmerkingen: string | null
  created_at: string
  vervoerders?: {
    code: string
    display_naam: string
    type: string
    actief: boolean
    label_breedte_mm: number | null
    label_hoogte_mm: number | null
  } | null
  orders: {
    id: number
    order_nr: string
    oud_order_nr: number | null
    klant_referentie: string | null
    orderdatum: string | null
    afleverdatum: string | null
    week: string | null
    afhalen: boolean | null
    lever_modus: string | null
    debiteur_nr: number
    vertegenw_code: string | null
    fact_naam: string | null
    fact_adres: string | null
    fact_postcode: string | null
    fact_plaats: string | null
    fact_land: string | null
    afl_naam_2: string | null
    debiteuren?: {
      naam: string | null
      gln_bedrijf: string | null
      /** Mig 303: per-klant voorkeur om tapijt-stickers ook voor standaard
       *  (niet-maatwerk) artikelen te printen bij de vervoerderslabels. */
      tapijt_sticker_bij_standaard: boolean | null
    } | null
    vertegenwoordigers?: {
      code: string
      naam: string | null
    } | null
  }
  /**
   * Mig 222: alle orders die aan deze zending hangen — ook de primaire
   * `zending.orders`. Voor solo-zendingen 1 element; voor bundels ≥2.
   * Bron: `zending_orders` M2M (backfill heeft bestaande 1-op-1 al gevuld).
   */
  bundel_orders: ZendingPrintBundelOrder[]
  zending_regels: ZendingPrintRegel[]
  zending_colli: ZendingPrintColli[]
}

/** Gedeelde select voor de overzichts- én zoek-query (zelfde rij-shape). */
const LIJST_SELECT = `
  id, zending_nr, status, vervoerder_code, verzenddatum, track_trace,
  afl_naam, afl_postcode, afl_plaats, afl_land,
  aantal_colli, totaal_gewicht_kg, created_at, gereed_op,
  orders!zendingen_order_id_fkey!inner (
    id, order_nr, debiteur_nr,
    debiteuren:debiteuren!orders_debiteur_nr_fkey (
      debiteur_nr, naam
    )
  ),
  zending_orders (
    order_id,
    bundel_order:orders!zending_orders_order_id_fkey (
      id, order_nr
    )
  ),
  verzend_wachtrij (
    id, status, extern_referentie, track_trace, sent_at
  )
`

/**
 * Lijst-query voor de logistiek-overzichtspagina.
 *
 * Mig 424 (ADR-0038): alle vervoerders delen één `verzend_wachtrij`-tabel,
 * gediscrimineerd op `vervoerder_code`. Eén zending heeft hooguit één
 * vervoerder, dus de embed levert 0 of 1 rij.
 */
export async function fetchZendingen(filters: ZendingenFilters = {}) {
  let q = supabase
    .from('zendingen')
    .select(LIJST_SELECT)
    // Sorteer op het moment dat de pickronde werd afgerond (zending →
    // 'Klaar voor verzending', mig 432). NULL (nog niet afgerond, bv. 'Picken')
    // achteraan; `id` als stabiele tiebreak binnen dezelfde dag.
    .order('gereed_op', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .limit(200)

  if (filters.status) {
    q = q.eq('status', filters.status)
  } else if (filters.exclude_picken !== false) {
    // Default: verberg lopende Pickrondes (status='Picken' / 'Gepland').
    q = q.in('status', ['Klaar voor verzending', 'Onderweg', 'Afgeleverd', 'Afgehaald'])
  }
  if (filters.debiteur_nr) q = q.eq('orders.debiteur_nr', filters.debiteur_nr)

  return await q
}

/**
 * Zoek zendingen op barcode (SSCC), ordernummer of zendingnummer.
 *
 * Use-case: HST/Rhenus mailt bij een manco-melding alléén de colli-barcodes
 * (de 20-cijferige labelbarcode = AI(00) + 18-cijferige SSCC). De operator
 * plakt die hier om snel te zien wélke zending/karpet het is.
 *
 * Zoekt over ALLE statussen (ook 'Picken' en al verzonden) — een manco-melding
 * gaat vrijwel altijd over een reeds verzonden zending, die de overzichtslijst
 * juist verbergt. De drie velden zitten in drie tabellen, dus we verzamelen
 * eerst de zending-ids en halen daarna de volledige rijen op.
 */
export async function zoekZendingen(term: string) {
  const t = term.trim()
  if (t.length < 2) return { data: [], error: null }

  // Labelbarcode draagt de AI(00)-prefix; zending_colli.sscc niet. Strip 'm zodat
  // een geplakte 20-cijferige barcode op de 18-cijferige SSCC matcht. Onze SSCC's
  // beginnen met de company-prefix (087159…), nooit met '00', dus dit is veilig.
  const sscc = t.replace(/^00/, '')

  const [opZending, opOrder, opColli] = await Promise.all([
    supabase.from('zendingen').select('id').ilike('zending_nr', `%${t}%`).limit(100),
    supabase
      .from('zending_orders')
      .select('zending_id, orders!inner(order_nr)')
      .ilike('orders.order_nr', `%${t}%`)
      .limit(100),
    supabase.from('zending_colli').select('zending_id').ilike('sscc', `%${sscc}%`).limit(100),
  ])

  const err = opZending.error ?? opOrder.error ?? opColli.error
  if (err) return { data: [], error: err }

  const ids = new Set<number>()
  opZending.data?.forEach((r) => ids.add(r.id as number))
  opOrder.data?.forEach((r) => ids.add((r as { zending_id: number }).zending_id))
  opColli.data?.forEach((r) => ids.add((r as { zending_id: number }).zending_id))

  if (ids.size === 0) return { data: [], error: null }

  return await supabase
    .from('zendingen')
    .select(LIJST_SELECT)
    .in('id', [...ids])
    .order('gereed_op', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .limit(200)
}

/**
 * Detail-query: één zending met alle gekoppelde data.
 *
 * Mig 222: bij gebundelde zendingen hangen er meerdere orders aan via
 * `zending_orders`. We joinen die M2M expliciet zodat de detail-UI alle
 * bron-orders kan tonen, niet alleen de primaire FK uit `zendingen.order_id`.
 */
export async function fetchZendingMetTransportorders(zending_nr: string) {
  return await supabase
    .from('zendingen')
    .select(
      `
      *,
      orders!zendingen_order_id_fkey!inner (
        *,
        debiteuren:debiteuren!orders_debiteur_nr_fkey (
          *
        )
      ),
      zending_orders (
        order_id,
        bundel_order:orders!zending_orders_order_id_fkey (
          id, order_nr, debiteur_nr,
          debiteuren:debiteuren!orders_debiteur_nr_fkey (
            debiteur_nr, naam
          )
        )
      ),
      zending_regels (
        *,
        order_regels (
          id, order_id, regelnummer, artikelnr, omschrijving
        )
      ),
      zending_colli (
        id, colli_nr, sscc, omschrijving_snapshot, bundel_colli_id, is_bundel
      ),
      verzend_wachtrij ( * )
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
      id, zending_nr, status, vervoerder_code, service_code, verzenddatum, track_trace,
      afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land, afl_telefoon, is_deelzending,
      aantal_colli, totaal_gewicht_kg, opmerkingen, created_at,
      vervoerders ( code, display_naam, type, actief, label_breedte_mm, label_hoogte_mm ),
      orders!zendingen_order_id_fkey!inner (
        id, order_nr, oud_order_nr, klant_referentie, orderdatum, afleverdatum,
        week, afhalen, lever_modus, debiteur_nr, vertegenw_code,
        fact_naam, fact_adres, fact_postcode, fact_plaats, fact_land,
        afl_naam_2,
        debiteuren:debiteuren!orders_debiteur_nr_fkey (
          naam, gln_bedrijf, tapijt_sticker_bij_standaard
        ),
        vertegenwoordigers ( code, naam )
      ),
      zending_orders (
        order_id,
        bundel_order:orders!zending_orders_order_id_fkey (
          id, order_nr, klant_referentie, week
        )
      ),
      zending_regels (
        id, order_regel_id, artikelnr, rol_id, aantal,
        order_regels (
          id, order_id, regelnummer, artikelnr, omschrijving, omschrijving_2, orderaantal, te_leveren,
          gewicht_kg, is_maatwerk, maatwerk_lengte_cm, maatwerk_breedte_cm,
          maatwerk_afwerking, maatwerk_band_kleur, maatwerk_kwaliteit_code, maatwerk_kleur_code,
          maatwerk_oppervlak_m2,
          producten!order_regels_artikelnr_fkey (
            ean_code, omschrijving, vervolgomschrijving, gewicht_kg,
            lengte_cm, breedte_cm, vorm, kleur_code, karpi_code, locatie
          )
        )
      ),
      zending_colli ( id, colli_nr, sscc, order_regel_id, omschrijving_snapshot, klant_omschrijving_snapshot, klanteigen_naam_snapshot, omsticker_snapshot, bundel_colli_id, is_bundel )
    `,
    )
    .eq('zending_nr', zending_nr)
    .single()

  if (error) throw toError(error, 'Verzendset ophalen mislukt')

  // Plat de M2M-join om naar `bundel_orders[]`. Voor solo-zendingen geeft de
  // backfill 1 rij; voor bundels geeft mig 222 N rijen. Sorteer op order_nr
  // zodat het pakbon-document een stabiele leesvolgorde heeft.
  const raw = data as unknown as ZendingPrintSet & {
    zending_orders?: Array<{
      order_id: number
      bundel_order: ZendingPrintBundelOrder | null
    }>
  }
  const bundel_orders: ZendingPrintBundelOrder[] = (raw.zending_orders ?? [])
    .map((row) => row.bundel_order)
    .filter((o): o is ZendingPrintBundelOrder => o != null)
    .sort((a, b) => a.order_nr.localeCompare(b.order_nr))

  // Defensieve fallback: ontbreekt M2M (mig 222 niet uitgevoerd?), val terug
  // op alleen de primaire order zodat de pakbon nog rendert.
  if (bundel_orders.length === 0 && raw.orders) {
    bundel_orders.push({
      id: raw.orders.id,
      order_nr: raw.orders.order_nr,
      klant_referentie: raw.orders.klant_referentie,
      week: raw.orders.week,
    })
  }

  return { ...raw, bundel_orders } as ZendingPrintSet
}

/**
 * Mig 248 (ADR-0012): canonieke RPC voor pickronde-start. Vervangt
 * de gedropte `startPickrondenVoorOrder` (mig 220) en `startPickrondenBundel` (mig 222).
 *
 * - 4D-uitbreiding default-on: orders met dezelfde 4D-bundel-sleutel uit
 *   `voorgestelde_zending_bundels` worden automatisch toegevoegd, ook als de
 *   caller maar één order meegeeft.
 * - `forceSoloIds`: orders die de operator expliciet *niet* in de bundel wil —
 *   krijgen elk een eigen zending zonder bundel-partners. Moet een subset van
 *   `orderIds` zijn; andere ids worden genegeerd.
 * - Multi-vervoerder-orders splitsen automatisch over meerdere zendingen
 *   (mig 220-gedrag blijft intact via per-orderregel-vervoerder-resolutie).
 *
 * Returns: één rij per aangemaakte zending. Voor de operator-UI navigeer je
 * doorgaans naar `/logistiek/printset/bulk?zendingen=<comma-separated nrs>`.
 */
export async function startPickrondes(
  orderIds: number[],
  pickerId: number | null,
  forceSoloIds: number[] = [],
): Promise<Array<ZendingAanmaakResult & { aantal_orders: number }>> {
  if (orderIds.length === 0) {
    throw new Error('startPickrondes: geen orders meegegeven')
  }
  const { data, error } = await supabase.rpc('start_pickronden', {
    p_order_ids: orderIds,
    p_picker_id: pickerId,
    p_force_solo_ids: forceSoloIds,
  })
  if (error) throw toError(error, 'Pickronde starten mislukt')

  const rows = (data ?? []) as Array<{
    zending_id: number | string
    zending_nr: string
    vervoerder_code: string | null
    aantal_regels: number
    aantal_orders: number
    is_nieuw: boolean
  }>

  if (rows.length === 0) {
    throw new Error('Pickronde gestart maar geen zendingen aangemaakt')
  }

  return rows.map((r) => ({
    id: Number(r.zending_id),
    zending_nr: r.zending_nr,
    vervoerder_code: r.vervoerder_code,
    aantal_regels: r.aantal_regels,
    aantal_orders: r.aantal_orders,
    is_nieuw: r.is_nieuw,
  }))
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

/**
 * Wikkel een Fout-rij af ZONDER opnieuw naar de vervoerder te versturen.
 *
 * Scenario: de zending is bij HST al in de portal beland maar was niet valide;
 * de operator heeft 'm dáár handmatig goedgezet. Opnieuw versturen zou een tweede
 * transportorder POST'en (HST is POST-only zonder idempotentie → dubbele
 * aanmelding, incident ZEND-2026-0061). Deze actie markeert de rij als Verstuurd
 * via de canonieke RPC `markeer_transportorder_verstuurd` (zet het idempotentie-
 * anker mig 435 + flipt de zending Klaar→Onderweg). Géén POST. extern_referentie
 * geeft de caller mee (uit de fout-rij); ontbreekt die → marker 'HANDMATIG-PORTAL'.
 */
export async function markeerZendingHandmatigAfgehandeld(
  transportorder_id: number,
  extern_referentie: string | null,
  vervoerder_code: string | null,
) {
  // ponytail: alleen HST's extern_referentie (= OrderNumber) is een echte T&T.
  // Bij Rhenus/Verhoek is extern_referentie de XML-bestandsnaam — géén T&T.
  const track_trace = vervoerder_code === 'hst_api' ? extern_referentie : null
  const { error } = await supabase.rpc('markeer_transportorder_verstuurd', {
    p_id: transportorder_id,
    p_extern_referentie: extern_referentie ?? 'HANDMATIG-PORTAL',
    p_track_trace: track_trace,

    p_document_pad: null,
  })
  if (error) throw error
}

/**
 * Markeer een afhaal-zending als afgehaald (mig 482-483). Afhaal-orders
 * (orders.afhalen) hebben geen vervoerder en blijven anders eeuwig op
 * 'Klaar voor verzending' staan. De order staat dan al op 'Verzonden'; dit
 * sluit alleen de zending af. Server-side gegate op afhaal + status.
 */
export async function markeerZendingAfgehaald(zending_id: number) {
  const { data, error } = await supabase.rpc('markeer_zending_afgehaald', {
    p_zending_id: zending_id,
  })
  if (error) throw toError(error, 'Afgehaald markeren mislukt')
  if (data !== 'afgehaald') {
    throw new Error(`Afgehaald markeren mislukt: ${String(data)}`)
  }
}
