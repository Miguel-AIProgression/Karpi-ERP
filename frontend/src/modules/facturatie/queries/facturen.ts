import { supabase } from '@/lib/supabase/client'

export type FactuurStatus =
  | 'Concept' | 'Verstuurd' | 'Betaald' | 'Herinnering' | 'Aanmaning' | 'Gecrediteerd'

export interface FactuurListItem {
  id: number
  factuur_nr: string
  debiteur_nr: number
  klant_naam?: string
  factuurdatum: string
  vervaldatum: string
  status: FactuurStatus
  totaal: number
  verstuurd_op: string | null
  pdf_storage_path: string | null
  /** Distinct orders op deze factuur (bundel = meerdere). Voor klikbare links. */
  orders: Array<{ id: number; nr: string }>
  /** Mig 456: NULL = BTW-regeling zeker, TIMESTAMPTZ = controle nodig sinds. */
  btw_controle_nodig_sinds: string | null
  /** Mig 467: NULL = debetfactuur, gevuld = creditnota. */
  credit_voor_factuur_id: number | null
}

/** True als de factuur een creditnota is (credit_voor_factuur_id IS NOT NULL). */
export function isFactuurCreditnota(f: Pick<FactuurListItem | FactuurDetail, 'credit_voor_factuur_id'>): boolean {
  return f.credit_voor_factuur_id != null
}

export interface FactuurDetail {
  id: number
  factuur_nr: string
  debiteur_nr: number
  factuurdatum: string
  vervaldatum: string
  status: FactuurStatus
  subtotaal: number
  btw_percentage: number
  btw_bedrag: number
  totaal: number
  fact_naam: string | null
  fact_adres: string | null
  fact_postcode: string | null
  fact_plaats: string | null
  fact_land: string | null
  btw_nummer: string | null
  opmerkingen: string | null
  pdf_storage_path: string | null
  verstuurd_op: string | null
  verstuurd_naar: string | null
  /** Mig 456: NULL = BTW-regeling zeker, TIMESTAMPTZ = controle nodig sinds. */
  btw_controle_nodig_sinds: string | null
  /** Mig 456: snapshot regeling-code (nl_binnenland/eu_b2b_icl/eu_b2b_binnenland_afwijking/export_buiten_eu). */
  btw_regeling: string | null
  /** Mig 371: intracommunautaire BTW-verlegging — true = 0% BTW op de factuur. */
  btw_verlegd: boolean | null
  /** Mig 467: verwijst naar de originele debetfactuur als dit een creditnota is. */
  credit_voor_factuur_id: number | null
}

export interface FactuurRegel {
  id: number
  factuur_id: number
  order_id: number
  order_regel_id: number
  regelnummer: number
  artikelnr: string | null
  omschrijving: string | null
  omschrijving_2: string | null
  uw_referentie: string | null
  order_nr: string | null
  aantal: number
  prijs: number
  korting_pct: number
  bedrag: number
  btw_percentage: number
}

export async function fetchFacturen(params?: { debiteurNr?: number }): Promise<FactuurListItem[]> {
  let q = supabase
    .from('facturen')
    .select(
      'id, factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status, totaal, verstuurd_op, pdf_storage_path, btw_controle_nodig_sinds, credit_voor_factuur_id, debiteuren(naam), factuur_regels(order_id, order_nr)',
    )
    .order('factuurdatum', { ascending: false })
    .order('factuur_nr', { ascending: false })
  if (params?.debiteurNr) q = q.eq('debiteur_nr', params.debiteurNr)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []).map((f) => {
    // Distinct orders verzamelen uit de factuurregels (1 factuur kan een
    // bundel van meerdere orders zijn). Dedup op order_id; order_nr als
    // weergave met #id-fallback wanneer het nr (nog) niet gevuld is.
    const regels = (f.factuur_regels ?? []) as Array<{
      order_id: number | null
      order_nr: string | null
    }>
    const ordersMap = new Map<number, string>()
    for (const r of regels) {
      if (r.order_id == null || ordersMap.has(r.order_id)) continue
      ordersMap.set(r.order_id, r.order_nr ?? `#${r.order_id}`)
    }
    return {
      id: f.id,
      factuur_nr: f.factuur_nr,
      debiteur_nr: f.debiteur_nr,
      klant_naam: (f.debiteuren as unknown as { naam: string } | null)?.naam,
      factuurdatum: f.factuurdatum,
      vervaldatum: f.vervaldatum,
      status: f.status as FactuurStatus,
      totaal: Number(f.totaal),
      verstuurd_op: f.verstuurd_op,
      pdf_storage_path: f.pdf_storage_path,
      orders: Array.from(ordersMap, ([id, nr]) => ({ id, nr })),
      btw_controle_nodig_sinds: f.btw_controle_nodig_sinds,
      credit_voor_factuur_id: (f as unknown as { credit_voor_factuur_id: number | null }).credit_voor_factuur_id ?? null,
    }
  })
}

export async function fetchFactuurDetail(
  id: number,
): Promise<{ factuur: FactuurDetail; regels: FactuurRegel[] }> {
  const { data: factuur, error: e1 } = await supabase
    .from('facturen').select('*').eq('id', id).single()
  if (e1) throw e1
  const { data: regels, error: e2 } = await supabase
    .from('factuur_regels').select('*').eq('factuur_id', id).order('regelnummer')
  if (e2) throw e2
  return { factuur: factuur as FactuurDetail, regels: (regels ?? []) as FactuurRegel[] }
}

export async function getFactuurPdfSignedUrl(pdfStoragePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('facturen').createSignedUrl(pdfStoragePath, 600)
  if (error) throw error
  return data.signedUrl
}

export async function renderFactuurPdfBlobUrl(factuurId: number): Promise<string> {
  const { data, error } = await supabase.functions.invoke('factuur-pdf', {
    body: { factuur_id: factuurId },
  })
  if (error) throw error

  let blob: Blob
  if (data instanceof Blob) {
    blob = data
  } else if (data instanceof ArrayBuffer) {
    blob = new Blob([data], { type: 'application/pdf' })
  } else if (data instanceof Uint8Array) {
    // Cast naar ArrayBuffer omdat TS 5.7+ Uint8Array.buffer als
    // ArrayBufferLike (ArrayBuffer | SharedArrayBuffer) typeert. fetch/edge-
    // function-responses zijn nooit shared, dus de cast is runtime-veilig.
    const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    blob = new Blob([ab], { type: 'application/pdf' })
  } else {
    throw new Error('Onverwacht response-type van factuur-pdf edge function')
  }
  return URL.createObjectURL(blob)
}

export interface FactuurVoorOrder {
  id: number
  factuur_nr: string
  status: FactuurStatus
  factuurdatum: string
  totaal: number
}

export async function fetchFacturenVoorOrder(orderId: number): Promise<FactuurVoorOrder[]> {
  const { data, error } = await supabase
    .from('factuur_regels')
    .select('facturen(id, factuur_nr, status, factuurdatum, totaal)')
    .eq('order_id', orderId)
  if (error) throw error
  const seen = new Set<number>()
  const out: FactuurVoorOrder[] = []
  for (const row of data ?? []) {
    const f = (row as unknown as { facturen: FactuurVoorOrder | null }).facturen
    if (!f || seen.has(f.id)) continue
    seen.add(f.id)
    out.push({ ...f, totaal: Number(f.totaal) })
  }
  out.sort((a, b) => b.factuurdatum.localeCompare(a.factuurdatum))
  return out
}

export async function fetchFacturenVoorOrders(
  orderIds: number[],
): Promise<Map<number, FactuurVoorOrder[]>> {
  const out = new Map<number, FactuurVoorOrder[]>()
  if (orderIds.length === 0) return out

  const { data, error } = await supabase
    .from('factuur_regels')
    .select('order_id, facturen(id, factuur_nr, status, factuurdatum, totaal)')
    .in('order_id', orderIds)
  if (error) throw error

  const seenPerOrder = new Map<number, Set<number>>()
  for (const row of data ?? []) {
    const r = row as unknown as { order_id: number; facturen: FactuurVoorOrder | null }
    if (!r.facturen) continue
    const seen = seenPerOrder.get(r.order_id) ?? new Set<number>()
    if (seen.has(r.facturen.id)) continue
    seen.add(r.facturen.id)
    seenPerOrder.set(r.order_id, seen)
    const list = out.get(r.order_id) ?? []
    list.push({ ...r.facturen, totaal: Number(r.facturen.totaal) })
    out.set(r.order_id, list)
  }
  for (const list of out.values()) {
    list.sort((a, b) => b.factuurdatum.localeCompare(a.factuurdatum))
  }
  return out
}

export interface EdiFactuurConfig {
  /** Heeft deze debiteur factuur-uit-via-EDI én Transus actief? */
  beschikbaar: boolean
}

/**
 * Bepaalt of voor deze debiteur een EDI-factuur verstuurd mag worden
 * (edi_handelspartner_config.factuur_uit && transus_actief).
 */
export async function fetchEdiFactuurConfig(debiteurNr: number): Promise<EdiFactuurConfig> {
  const { data, error } = await supabase
    .from('edi_handelspartner_config')
    .select('factuur_uit, transus_actief')
    .eq('debiteur_nr', debiteurNr)
    .maybeSingle()
  if (error) throw error
  const row = data as { factuur_uit: boolean; transus_actief: boolean } | null
  return { beschikbaar: Boolean(row?.factuur_uit && row?.transus_actief) }
}

export interface VerstuurFactuurEdiResult {
  uitgaandId: number
  reedsAanwezig: boolean
  status: string
}

/**
 * Zet de factuur op de uitgaande EDI-wachtrij via de edge function
 * `bouw-factuur-edi`. De cron `transus-send` verstuurt hem daarna via M10100.
 */
export async function verstuurFactuurViaEdi(factuurId: number): Promise<VerstuurFactuurEdiResult> {
  const { data, error } = await supabase.functions.invoke('bouw-factuur-edi', {
    body: { factuur_id: factuurId },
  })
  if (error) {
    // Edge function geeft 4xx met JSON {error}; haal die boodschap eruit.
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = await ctx.json()
        throw new Error(body?.error ?? error.message)
      } catch (e) {
        if (e instanceof Error && e.message) throw e
      }
    }
    throw error
  }
  return data as VerstuurFactuurEdiResult
}

export async function zetFactuurOpBetaald(id: number): Promise<void> {
  const { error } = await supabase
    .from('facturen').update({ status: 'Betaald' }).eq('id', id)
  if (error) throw error
}

/**
 * Mig 456: bevestigt dat de BTW-regeling op deze concept-factuur klopt, ook al
 * signaleerde bepaal_btw_regeling een afwijking (eu_b2b_binnenland_afwijking/
 * export_buiten_eu/eu_b2b_icl-zonder-nummer). Wist de gate zonder data te
 * wijzigen — analoog markeer_prijs_geaccepteerd.
 */
export async function markeerBtwRegelingGeaccepteerd(factuurId: number): Promise<void> {
  const { error } = await supabase.rpc('markeer_btw_regeling_geaccepteerd', {
    p_factuur_id: factuurId,
  })
  if (error) throw error
}

/** Telling voor de facturen-overzicht-banner (mig 456). */
export async function countBtwControleNodigFacturen(): Promise<number> {
  const { count, error } = await supabase
    .from('facturen')
    .select('id', { count: 'exact', head: true })
    .not('btw_controle_nodig_sinds', 'is', null)
  if (error) throw error
  return count ?? 0
}

export async function zetFactuurStatus(id: number, status: FactuurStatus): Promise<void> {
  const { error } = await supabase
    .from('facturen').update({ status }).eq('id', id)
  if (error) throw error
}

export async function zetFactuurStatusBulk(
  ids: number[],
  status: FactuurStatus,
): Promise<void> {
  if (ids.length === 0) return
  const { error } = await supabase
    .from('facturen').update({ status }).in('id', ids)
  if (error) throw error
}

export interface BundelInfoVoorFactuur {
  isBundel: boolean
  heeftDrempelKorting: boolean
  verzendkostenTotaal: number
  bundelKortingBedrag: number
  drempelKortingBedrag: number
  andereOrders: Array<{ id: number; nr: string }>
}

export async function fetchBundelInfoVoorFactuur(
  factuurId: number,
): Promise<BundelInfoVoorFactuur> {
  const { data, error } = await supabase
    .from('factuur_regels')
    .select('order_id, order_nr, artikelnr, bedrag')
    .eq('factuur_id', factuurId)
  if (error) throw error

  const rows = (data ?? []) as Array<{
    order_id: number
    order_nr: string | null
    artikelnr: string | null
    bedrag: number | string
  }>

  // SCOPE (ADR-0018): factuur-niveau identificatie is per-type, niet generieke
  // pseudo-skip. De banner-tekst onderscheidt expliciet welke korting actief is
  // (BUNDELKORTING-tegenboeking vs. DREMPELKORTING-cadeau), dus specifieke
  // artikelnr-matches blijven hier juist. Voor generieke "is admin-pseudo?":
  // gebruik isAdminPseudo(regel) uit `@/lib/orders/admin-pseudo`.
  const productRegels = rows.filter(
    (r) =>
      r.artikelnr !== 'VERZEND' &&
      r.artikelnr !== 'BUNDELKORTING' &&
      r.artikelnr !== 'DREMPELKORTING',
  )
  const verzendRegels = rows.filter((r) => r.artikelnr === 'VERZEND')
  const bundelKortingRegel = rows.find((r) => r.artikelnr === 'BUNDELKORTING')
  const drempelKortingRegel = rows.find((r) => r.artikelnr === 'DREMPELKORTING')

  const ordersMap = new Map<number, string>()
  for (const r of productRegels) {
    if (!ordersMap.has(r.order_id)) {
      ordersMap.set(r.order_id, r.order_nr ?? `#${r.order_id}`)
    }
  }
  const orders = Array.from(ordersMap, ([id, nr]) => ({ id, nr }))

  // Banner mag alleen renderen op mig-261-gevormde facturen (V2-layout):
  // >1 product-order EN BUNDELKORTING-regel aanwezig. Legacy multi-order
  // facturen zonder BUNDELKORTING bevatten geen besparing.
  const isBundel = orders.length > 1 && Boolean(bundelKortingRegel)
  const heeftDrempelKorting = Boolean(drempelKortingRegel)

  return {
    isBundel,
    heeftDrempelKorting,
    verzendkostenTotaal: verzendRegels.reduce(
      (sum, r) => sum + Math.abs(Number(r.bedrag)),
      0,
    ),
    bundelKortingBedrag: bundelKortingRegel
      ? Math.abs(Number(bundelKortingRegel.bedrag))
      : 0,
    drempelKortingBedrag: drempelKortingRegel
      ? Math.abs(Number(drempelKortingRegel.bedrag))
      : 0,
    andereOrders: isBundel ? orders : [],
  }
}

/** Geeft alle creditnotas terug die verwijzen naar p_factuur_id (debetfactuur). */
export async function fetchCreditnotasVoorFactuur(factuurId: number): Promise<FactuurListItem[]> {
  const { data, error } = await supabase
    .from('facturen')
    .select(
      'id, factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status, totaal, verstuurd_op, pdf_storage_path, btw_controle_nodig_sinds, credit_voor_factuur_id, debiteuren(naam), factuur_regels(order_id, order_nr)',
    )
    .eq('credit_voor_factuur_id', factuurId)
    .order('factuurdatum', { ascending: false })
  if (error) throw error
  return (data ?? []).map((f) => {
    const regels = (f.factuur_regels ?? []) as Array<{ order_id: number | null; order_nr: string | null }>
    const ordersMap = new Map<number, string>()
    for (const r of regels) {
      if (r.order_id == null || ordersMap.has(r.order_id)) continue
      ordersMap.set(r.order_id, r.order_nr ?? `#${r.order_id}`)
    }
    return {
      id: f.id,
      factuur_nr: f.factuur_nr,
      debiteur_nr: f.debiteur_nr,
      klant_naam: (f.debiteuren as unknown as { naam: string } | null)?.naam,
      factuurdatum: f.factuurdatum,
      vervaldatum: f.vervaldatum,
      status: f.status as FactuurStatus,
      totaal: Number(f.totaal),
      verstuurd_op: f.verstuurd_op,
      pdf_storage_path: f.pdf_storage_path,
      orders: Array.from(ordersMap, ([id, nr]) => ({ id, nr })),
      btw_controle_nodig_sinds: f.btw_controle_nodig_sinds,
      credit_voor_factuur_id: (f as unknown as { credit_voor_factuur_id: number | null }).credit_voor_factuur_id ?? null,
    }
  })
}

export interface MaakCreditfactuurParams {
  factuur_id: number
  reden?: string
  /** Modus A: selecteer specifieke factuurregels (volledig aantal). */
  factuur_regel_ids?: number[]
  /** Modus B: deelcredit met aangepast aantal per regel. */
  deelcredit_regels?: Array<{ id: number; aantal: number }>
  /** Modus C: vrij creditbedrag (los van regels). */
  los_bedrag?: number
  /** Modus C: true = los_bedrag is incl. BTW, false = excl. */
  los_bedrag_incl_btw?: boolean
  /** Modus C: omschrijving van de losse creditregel. */
  los_reden?: string
  /** D: producten.voorraad ophogen met gecrediteerde aantallen. */
  voorraad_bijwerken?: boolean
}

/** Maakt een creditnota op de RPC `maak_creditfactuur` en geeft het nieuwe factuur-id terug. */
export async function maakCreditfactuur(params: MaakCreditfactuurParams): Promise<number> {
  const { data, error } = await supabase.rpc('maak_creditfactuur', {
    p_factuur_id:          params.factuur_id,
    p_reden:               params.reden ?? null,
    p_factuur_regel_ids:   params.factuur_regel_ids ?? null,
    p_deelcredit_regels:   params.deelcredit_regels ? JSON.stringify(params.deelcredit_regels) : null,
    p_los_bedrag:          params.los_bedrag ?? null,
    p_los_bedrag_incl_btw: params.los_bedrag_incl_btw ?? null,
    p_los_reden:           params.los_reden ?? null,
    p_voorraad_bijwerken:  params.voorraad_bijwerken ?? false,
  })
  if (error) throw error
  return data as number
}

/** Verstuurt een creditnota per e-mail via de edge function `stuur-creditfactuur`. */
export async function stuurCreditfactuur(
  factuurId: number,
): Promise<{ ok: boolean; verstuurd_naar: string }> {
  const { data, error } = await supabase.functions.invoke('stuur-creditfactuur', {
    body: { factuur_id: factuurId },
  })
  if (error) {
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = await ctx.json()
        throw new Error(body?.error ?? error.message)
      } catch (e) {
        if (e instanceof Error && e.message) throw e
      }
    }
    throw error
  }
  return data as { ok: boolean; verstuurd_naar: string }
}
