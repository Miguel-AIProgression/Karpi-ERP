import { supabase } from '../client'

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
      'id, factuur_nr, debiteur_nr, factuurdatum, vervaldatum, status, totaal, verstuurd_op, pdf_storage_path, debiteuren(naam)',
    )
    .order('factuurdatum', { ascending: false })
  if (params?.debiteurNr) q = q.eq('debiteur_nr', params.debiteurNr)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []).map((f) => ({
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
  }))
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

export async function zetFactuurOpBetaald(id: number): Promise<void> {
  const { error } = await supabase
    .from('facturen').update({ status: 'Betaald' }).eq('id', id)
  if (error) throw error
}
