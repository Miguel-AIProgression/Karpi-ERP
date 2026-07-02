import { supabase } from '@/lib/supabase/client'

export type InkooporderStatus =
  | 'Concept'
  | 'Besteld'
  | 'Deels ontvangen'
  | 'Ontvangen'
  | 'Geannuleerd'

export interface InkooporderOverzichtRow {
  id: number
  inkooporder_nr: string
  oud_inkooporder_nr: number | null
  status: InkooporderStatus
  besteldatum: string | null
  leverweek: string | null
  verwacht_datum: string | null
  bron: string
  leverancier_id: number | null
  leverancier_naam: string | null
  leverancier_woonplaats: string | null
  aantal_regels: number
  totaal_besteld_m: number
  totaal_geleverd_m: number
  totaal_te_leveren_m: number
}

export interface InkooporderDetail {
  id: number
  inkooporder_nr: string
  oud_inkooporder_nr: number | null
  status: InkooporderStatus
  besteldatum: string | null
  leverweek: string | null
  verwacht_datum: string | null
  bron: string
  leverancier_id: number | null
  opmerkingen: string | null
  created_at: string
  updated_at: string
  leverancier: { id: number; naam: string; woonplaats: string | null } | null
}

export type RegelEenheid = 'm' | 'stuks'

export interface InkooporderRegel {
  id: number
  inkooporder_id: number
  regelnummer: number
  artikelnr: string | null
  artikel_omschrijving: string | null
  karpi_code: string | null
  inkoopprijs_eur: number | null
  besteld_m: number
  geleverd_m: number
  te_leveren_m: number
  eenheid: RegelEenheid
  status_excel: number | null
  /** Sinds migratie 150: aantal stuks van deze IO-regel dat aan klantorders is geclaimd. */
  aantal_geclaimd?: number
  /** Sinds migratie 150: aantal stuks dat nog vrij is (FLOOR(te_leveren_m) − aantal_geclaimd). */
  aantal_vrij?: number
  /** Sinds migratie 150: aantal distincte orderregels dat op deze IO-regel wacht. */
  aantal_orderregels?: number
  /** Sinds migratie 318/319: per-regel ETA, bijgewerkt via update_regel_eta (Karpi of leverancier-portal). */
  verwacht_datum: string | null
  eta_bijgewerkt_door: 'karpi' | 'leverancier' | null
  eta_bijgewerkt_op: string | null
  leverancier_notitie: string | null
}

export interface InkooporderFilters {
  status?: InkooporderStatus | 'alle'
  leverancier_id?: number | 'alle'
  alleen_open?: boolean
  zoek?: string
}

export interface InkooporderFormData {
  leverancier_id: number
  besteldatum?: string | null
  leverweek?: string | null
  verwacht_datum?: string | null
  status?: InkooporderStatus
  opmerkingen?: string | null
}

export interface InkooporderRegelInput {
  regelnummer: number
  artikelnr: string | null
  karpi_code?: string | null
  artikel_omschrijving?: string | null
  inkoopprijs_eur?: number | null
  besteld_m: number
  eenheid?: RegelEenheid
}

export async function fetchInkooporders(filters: InkooporderFilters = {}): Promise<InkooporderOverzichtRow[]> {
  let query = supabase
    .from('inkooporders_overzicht')
    .select('*')
    .order('verwacht_datum', { ascending: true, nullsFirst: false })
    .order('besteldatum', { ascending: false })

  if (filters.status && filters.status !== 'alle') {
    query = query.eq('status', filters.status)
  }
  if (filters.leverancier_id && filters.leverancier_id !== 'alle') {
    query = query.eq('leverancier_id', filters.leverancier_id)
  }
  if (filters.alleen_open) {
    query = query.gt('totaal_te_leveren_m', 0)
  }

  const { data, error } = await query
  if (error) throw error

  let rows = (data ?? []).map((r) => ({
    id: r.id,
    inkooporder_nr: r.inkooporder_nr,
    oud_inkooporder_nr: r.oud_inkooporder_nr,
    status: r.status as InkooporderStatus,
    besteldatum: r.besteldatum,
    leverweek: r.leverweek,
    verwacht_datum: r.verwacht_datum,
    bron: r.bron,
    leverancier_id: r.leverancier_id,
    leverancier_naam: r.leverancier_naam,
    leverancier_woonplaats: r.leverancier_woonplaats,
    aantal_regels: Number(r.aantal_regels ?? 0),
    totaal_besteld_m: Number(r.totaal_besteld_m ?? 0),
    totaal_geleverd_m: Number(r.totaal_geleverd_m ?? 0),
    totaal_te_leveren_m: Number(r.totaal_te_leveren_m ?? 0),
  }))

  if (filters.zoek?.trim()) {
    const q = filters.zoek.trim().toLowerCase()
    rows = rows.filter(
      (r) =>
        r.inkooporder_nr.toLowerCase().includes(q) ||
        (r.oud_inkooporder_nr !== null && String(r.oud_inkooporder_nr).includes(q)) ||
        (r.leverancier_naam ?? '').toLowerCase().includes(q),
    )
  }

  return rows
}

export interface RegelContext {
  breedte_cm: number | null
  typische_lengte_cm: number | null
}

export async function fetchInkooporderRegelContext(
  artikelnrs: string[],
): Promise<Map<string, RegelContext>> {
  const result = new Map<string, RegelContext>()
  const unieke = [...new Set(artikelnrs.filter(Boolean))]
  if (unieke.length === 0) return result

  // Stap 1: kwaliteit_code per artikel
  const { data: producten, error: e1 } = await supabase
    .from('producten')
    .select('artikelnr, kwaliteit_code')
    .in('artikelnr', unieke)
  if (e1) throw e1

  const kwaliteitPerArtikel = new Map<string, string | null>()
  for (const p of (producten ?? []) as Array<{ artikelnr: string; kwaliteit_code: string | null }>) {
    kwaliteitPerArtikel.set(p.artikelnr, p.kwaliteit_code)
  }

  // Stap 2: standaard_breedte_cm per kwaliteit
  const unieke_kw = [...new Set(Array.from(kwaliteitPerArtikel.values()).filter((k): k is string => !!k))]
  const breedtePerKwaliteit = new Map<string, number | null>()
  if (unieke_kw.length > 0) {
    const { data: kwaliteiten, error: e2 } = await supabase
      .from('kwaliteiten')
      .select('code, standaard_breedte_cm')
      .in('code', unieke_kw)
    if (e2) throw e2
    for (const k of (kwaliteiten ?? []) as Array<{ code: string; standaard_breedte_cm: number | null }>) {
      breedtePerKwaliteit.set(k.code, k.standaard_breedte_cm)
    }
  }

  // Stap 3: rollen per artikel → MAX breedte, AVG lengte (client-side aggregatie)
  const { data: rollen, error: e3 } = await supabase
    .from('rollen')
    .select('artikelnr, breedte_cm, lengte_cm, status')
    .in('artikelnr', unieke)
    .gt('breedte_cm', 0)
    .gt('lengte_cm', 0)
  if (e3) throw e3

  interface RolAgg {
    breedte_max: number
    lengte_som: number
    lengte_n: number
  }
  const rolAgg = new Map<string, RolAgg>()
  const uitgesloten_status = new Set(['verkocht', 'gesneden'])
  for (const r of (rollen ?? []) as Array<{ artikelnr: string; breedte_cm: number; lengte_cm: number; status: string }>) {
    if (uitgesloten_status.has(r.status)) continue
    const agg = rolAgg.get(r.artikelnr) ?? { breedte_max: 0, lengte_som: 0, lengte_n: 0 }
    if (r.breedte_cm > agg.breedte_max) agg.breedte_max = r.breedte_cm
    agg.lengte_som += r.lengte_cm
    agg.lengte_n += 1
    rolAgg.set(r.artikelnr, agg)
  }

  // Combineer per artikelnr
  for (const artikelnr of unieke) {
    const kw = kwaliteitPerArtikel.get(artikelnr)
    const breedte_kw = kw ? breedtePerKwaliteit.get(kw) ?? null : null
    const agg = rolAgg.get(artikelnr)
    const breedte_cm = breedte_kw ?? agg?.breedte_max ?? null
    const typische_lengte_cm = agg && agg.lengte_n > 0 ? Math.round(agg.lengte_som / agg.lengte_n) : null
    result.set(artikelnr, { breedte_cm, typische_lengte_cm })
  }

  return result
}

export async function fetchInkooporderDetail(
  id: number,
): Promise<{
  order: InkooporderDetail
  regels: InkooporderRegel[]
  context: Map<string, RegelContext>
  rolIdsPerRegel: Map<number, number[]>
} | null> {
  const { data: order, error: e1 } = await supabase
    .from('inkooporders')
    .select('*, leverancier:leveranciers!inkooporders_leverancier_id_fkey(id, naam, woonplaats)')
    .eq('id', id)
    .maybeSingle()
  if (e1) {
    console.error('fetchInkooporderDetail: order query error', { id, error: e1 })
    throw e1
  }
  if (!order) return null

  const { data: regels, error: e2 } = await supabase
    .from('inkooporder_regels')
    .select('*')
    .eq('inkooporder_id', id)
    .order('regelnummer')
  if (e2) {
    console.error('fetchInkooporderDetail: regels query error', { id, error: e2 })
    throw e2
  }

  // Claim-aantallen per regel ophalen uit view (migratie 150)
  const regelIdsForClaims = (regels ?? []).map((r) => r.id as number)
  const claimMap = new Map<number, { aantal_geclaimd: number; aantal_vrij: number; aantal_orderregels: number }>()
  if (regelIdsForClaims.length > 0) {
    const { data: claimRows, error: eClaims } = await supabase
      .from('inkooporder_regel_claim_zicht')
      .select('inkooporder_regel_id, aantal_geclaimd, aantal_vrij, aantal_orderregels')
      .in('inkooporder_regel_id', regelIdsForClaims)
    if (eClaims) {
      console.error('fetchInkooporderDetail: claim-zicht query error', { id, error: eClaims })
    } else {
      for (const c of (claimRows ?? []) as Array<{ inkooporder_regel_id: number; aantal_geclaimd: number; aantal_vrij: number; aantal_orderregels: number }>) {
        claimMap.set(c.inkooporder_regel_id, {
          aantal_geclaimd: Number(c.aantal_geclaimd ?? 0),
          aantal_vrij: Number(c.aantal_vrij ?? 0),
          aantal_orderregels: Number(c.aantal_orderregels ?? 0),
        })
      }
    }
  }
  const regelsMetClaims = (regels ?? []).map((r) => ({
    ...(r as InkooporderRegel),
    ...(claimMap.get((r as { id: number }).id) ?? { aantal_geclaimd: 0, aantal_vrij: 0, aantal_orderregels: 0 }),
  })) as InkooporderRegel[]

  const artikelnrs = (regels ?? [])
    .map((r) => r.artikelnr)
    .filter((a): a is string => !!a)
  const context = await fetchInkooporderRegelContext(artikelnrs)

  const regelIds = (regels ?? []).map((r) => r.id)
  const rolIdsPerRegel = new Map<number, number[]>()
  if (regelIds.length > 0) {
    const { data: rollen, error: e3 } = await supabase
      .from('rollen')
      .select('id, inkooporder_regel_id')
      .in('inkooporder_regel_id', regelIds)
      .order('id', { ascending: true })
    if (e3) {
      console.error('fetchInkooporderDetail: rollen query error', { id, error: e3 })
      throw e3
    }
    for (const r of rollen ?? []) {
      const regelId = (r as { inkooporder_regel_id: number | null }).inkooporder_regel_id
      if (regelId == null) continue
      const list = rolIdsPerRegel.get(regelId) ?? []
      list.push((r as { id: number }).id)
      rolIdsPerRegel.set(regelId, list)
    }
  }

  return {
    order: order as unknown as InkooporderDetail,
    regels: regelsMetClaims,
    context,
    rolIdsPerRegel,
  }
}

export async function fetchInkooporderStats(): Promise<{
  openstaande_orders: number
  openstaande_meters: number
  achterstallig: number
  deze_week: number
}> {
  const today = new Date().toISOString().slice(0, 10)
  const weekEnd = new Date()
  weekEnd.setDate(weekEnd.getDate() + 7)
  const weekEndStr = weekEnd.toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from('inkooporders_overzicht')
    .select('status, verwacht_datum, totaal_te_leveren_m')
    .in('status', ['Concept', 'Besteld', 'Deels ontvangen'])
  if (error) throw error

  const rows = (data ?? []) as Array<{
    status: string
    verwacht_datum: string | null
    totaal_te_leveren_m: number
  }>
  const open = rows.filter((r) => Number(r.totaal_te_leveren_m ?? 0) > 0)

  return {
    openstaande_orders: open.length,
    openstaande_meters: open.reduce((s, r) => s + Number(r.totaal_te_leveren_m ?? 0), 0),
    achterstallig: open.filter((r) => r.verwacht_datum && r.verwacht_datum < today).length,
    deze_week: open.filter(
      (r) => r.verwacht_datum && r.verwacht_datum >= today && r.verwacht_datum <= weekEndStr,
    ).length,
  }
}

export async function createInkooporder(
  header: InkooporderFormData,
  regels: InkooporderRegelInput[],
): Promise<number> {
  // Eén transactionele RPC (mig 601) — geen half-aangemaakte orders meer.
  const { data, error } = await supabase.rpc('create_inkooporder', {
    p_header: {
      leverancier_id: header.leverancier_id,
      besteldatum: header.besteldatum ?? null,
      leverweek: header.leverweek ?? null,
      verwacht_datum: header.verwacht_datum ?? null,
      opmerkingen: header.opmerkingen ?? null,
    },
    p_regels: regels.map((r) => ({
      artikelnr: r.artikelnr,
      karpi_code: r.karpi_code ?? null,
      artikel_omschrijving: r.artikel_omschrijving ?? null,
      inkoopprijs_eur: r.inkoopprijs_eur ?? null,
      besteld_m: r.besteld_m,
      eenheid: r.eenheid ?? 'm',
    })),
  })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as { inkooporder_id: number }
  return Number(row.inkooporder_id)
}

export async function updateInkooporderStatus(id: number, status: InkooporderStatus): Promise<void> {
  const { error } = await supabase.from('inkooporders').update({ status }).eq('id', id)
  if (error) throw error
}

export interface OntvangstRol {
  rolnummer?: string | null
  lengte_cm: number
  breedte_cm: number
  /** Mig 603: optionele magazijnlocatie-code (bv. "A.01.L") — wordt server-side
   *  gekoppeld via create_or_get_magazijn_locatie. */
  locatie?: string | null
}

export async function boekOntvangst(
  regel_id: number,
  rollen: OntvangstRol[],
  medewerker?: string,
  staOverleveringToe = false,
): Promise<Array<{ rol_id: number; rolnummer: string }>> {
  const { data, error } = await supabase.rpc('boek_inkooporder_ontvangst_rollen', {
    p_regel_id: regel_id,
    p_rollen: rollen,
    p_medewerker: medewerker ?? null,
    p_sta_overlevering_toe: staOverleveringToe,
  })
  if (error) throw error
  return (data ?? []) as Array<{ rol_id: number; rolnummer: string }>
}

export async function boekVoorraadOntvangst(
  regel_id: number,
  aantal: number,
  medewerker?: string,
): Promise<void> {
  const { error } = await supabase.rpc('boek_inkooporder_ontvangst_stuks', {
    p_regel_id: regel_id,
    p_aantal: aantal,
    p_medewerker: medewerker ?? null,
  })
  if (error) throw error
}

export interface HuidigeRol {
  id: number
  rolnummer: string
  lengte_cm: number | null
  breedte_cm: number | null
  oppervlak_m2: number | null
  status: string
}

export async function fetchRollenVoorStickers(
  rol_ids: number[],
): Promise<Array<import('../components/rol-sticker-layout').RolStickerData>> {
  if (rol_ids.length === 0) return []
  const { data, error } = await supabase
    .from('rollen')
    .select(
      `id, rolnummer, karpi_code, omschrijving, kwaliteit_code, kleur_code,
       lengte_cm, breedte_cm, oppervlak_m2,
       inkooporder_regel:inkooporder_regels!rollen_inkooporder_regel_id_fkey (
         inkooporder:inkooporders!inkooporder_regels_inkooporder_id_fkey (
           inkooporder_nr,
           leverancier:leveranciers!inkooporders_leverancier_id_fkey ( naam )
         )
       )`,
    )
    .in('id', rol_ids)
  if (error) throw error
  type RowInkooporder = { inkooporder_nr: string | null; leverancier: { naam: string | null } | null }
  type RowRegel = { inkooporder: RowInkooporder | null }
  type Row = {
    id: number
    rolnummer: string
    karpi_code: string | null
    omschrijving: string | null
    kwaliteit_code: string | null
    kleur_code: string | null
    lengte_cm: number | null
    breedte_cm: number | null
    oppervlak_m2: number | null
    inkooporder_regel: RowRegel | null
  }
  return (data ?? []).map((r) => {
    const row = r as unknown as Row
    return {
      id: row.id,
      rolnummer: row.rolnummer,
      karpi_code: row.karpi_code,
      omschrijving: row.omschrijving,
      kwaliteit_code: row.kwaliteit_code,
      kleur_code: row.kleur_code,
      lengte_cm: row.lengte_cm,
      breedte_cm: row.breedte_cm,
      oppervlak_m2: row.oppervlak_m2 != null ? Number(row.oppervlak_m2) : null,
      leverancier_naam: row.inkooporder_regel?.inkooporder?.leverancier?.naam ?? null,
      inkooporder_nr: row.inkooporder_regel?.inkooporder?.inkooporder_nr ?? null,
    }
  })
}

export interface OpenstaandeInkoopRegel {
  regel_id: number
  inkooporder_id: number
  inkooporder_nr: string
  order_status: InkooporderStatus
  besteldatum: string | null
  leverweek: string | null
  verwacht_datum: string | null
  leverancier_id: number | null
  leverancier_naam: string | null
  regelnummer: number
  artikelnr: string | null
  besteld_m: number
  geleverd_m: number
  te_leveren_m: number
}

export async function fetchOpenstaandeInkoopregelsVoorArtikel(
  artikelnr: string,
): Promise<OpenstaandeInkoopRegel[]> {
  const { data, error } = await supabase
    .from('openstaande_inkooporder_regels')
    .select(
      `regel_id, inkooporder_id, inkooporder_nr, order_status,
       besteldatum, leverweek, verwacht_datum,
       leverancier_id, leverancier_naam,
       regelnummer, artikelnr, besteld_m, geleverd_m, te_leveren_m`,
    )
    .eq('artikelnr', artikelnr)
    .order('verwacht_datum', { ascending: true, nullsFirst: false })
    .order('besteldatum', { ascending: false })
  if (error) throw error

  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    regel_id: Number(r.regel_id),
    inkooporder_id: Number(r.inkooporder_id),
    inkooporder_nr: String(r.inkooporder_nr ?? ''),
    order_status: r.order_status as InkooporderStatus,
    besteldatum: (r.besteldatum as string | null) ?? null,
    leverweek: (r.leverweek as string | null) ?? null,
    verwacht_datum: (r.verwacht_datum as string | null) ?? null,
    leverancier_id: r.leverancier_id == null ? null : Number(r.leverancier_id),
    leverancier_naam: (r.leverancier_naam as string | null) ?? null,
    regelnummer: Number(r.regelnummer ?? 0),
    artikelnr: (r.artikelnr as string | null) ?? null,
    besteld_m: Number(r.besteld_m ?? 0),
    geleverd_m: Number(r.geleverd_m ?? 0),
    te_leveren_m: Number(r.te_leveren_m ?? 0),
  }))
}

export interface OpenRegelOverzichtRow {
  regel_id: number
  inkooporder_id: number
  inkooporder_nr: string
  order_status: InkooporderStatus
  besteldatum: string | null
  leverweek: string | null
  verwacht_datum: string | null
  leverancier_id: number | null
  leverancier_naam: string | null
  regelnummer: number
  artikelnr: string | null
  karpi_code: string | null
  artikel_omschrijving: string | null
  product_omschrijving: string | null
  besteld_m: number
  geleverd_m: number
  te_leveren_m: number
  eenheid: RegelEenheid
  eta_bijgewerkt_door: 'karpi' | 'leverancier' | null
  eta_bijgewerkt_op: string | null
  leverancier_notitie: string | null
  /** Mig 438/444: cm van deze (nog niet ontvangen) rol al geclaimd door
   *  snijplannen.status='Wacht op inkoop'. 0 = geen snijplan-claim. */
  snijplan_gebruikte_lengte_cm: number
}

export async function fetchOpenRegelOverzicht(
  leverancierId?: number | 'alle',
): Promise<OpenRegelOverzichtRow[]> {
  let q = supabase
    .from('openstaande_inkooporder_regels')
    .select(
      `regel_id, inkooporder_id, inkooporder_nr, order_status,
       besteldatum, leverweek, verwacht_datum,
       leverancier_id, leverancier_naam,
       regelnummer, artikelnr, karpi_code, artikel_omschrijving, product_omschrijving,
       besteld_m, geleverd_m, te_leveren_m, eenheid,
       eta_bijgewerkt_door, eta_bijgewerkt_op, leverancier_notitie,
       snijplan_gebruikte_lengte_cm`,
    )
    .order('verwacht_datum', { ascending: true, nullsFirst: false })
    .order('leverancier_naam', { ascending: true })
    .order('inkooporder_nr', { ascending: true })
    .order('regelnummer', { ascending: true })

  if (leverancierId && leverancierId !== 'alle') {
    q = q.eq('leverancier_id', leverancierId)
  }

  const { data, error } = await q
  if (error) throw error

  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    regel_id: Number(r.regel_id),
    inkooporder_id: Number(r.inkooporder_id),
    inkooporder_nr: String(r.inkooporder_nr ?? ''),
    order_status: r.order_status as InkooporderStatus,
    besteldatum: (r.besteldatum as string | null) ?? null,
    leverweek: (r.leverweek as string | null) ?? null,
    verwacht_datum: (r.verwacht_datum as string | null) ?? null,
    leverancier_id: r.leverancier_id == null ? null : Number(r.leverancier_id),
    leverancier_naam: (r.leverancier_naam as string | null) ?? null,
    regelnummer: Number(r.regelnummer ?? 0),
    artikelnr: (r.artikelnr as string | null) ?? null,
    karpi_code: (r.karpi_code as string | null) ?? null,
    artikel_omschrijving: (r.artikel_omschrijving as string | null) ?? null,
    product_omschrijving: (r.product_omschrijving as string | null) ?? null,
    besteld_m: Number(r.besteld_m ?? 0),
    geleverd_m: Number(r.geleverd_m ?? 0),
    te_leveren_m: Number(r.te_leveren_m ?? 0),
    eenheid: (r.eenheid as RegelEenheid) ?? 'm',
    eta_bijgewerkt_door: (r.eta_bijgewerkt_door as 'karpi' | 'leverancier' | null) ?? null,
    eta_bijgewerkt_op: (r.eta_bijgewerkt_op as string | null) ?? null,
    leverancier_notitie: (r.leverancier_notitie as string | null) ?? null,
    snijplan_gebruikte_lengte_cm: Number(r.snijplan_gebruikte_lengte_cm ?? 0),
  }))
}

export async function fetchRollenVoorArtikel(artikelnr: string): Promise<HuidigeRol[]> {
  const { data, error } = await supabase
    .from('rollen')
    .select('id, rolnummer, lengte_cm, breedte_cm, oppervlak_m2, status')
    .eq('artikelnr', artikelnr)
    .not('status', 'in', '(verkocht,gesneden)')
    .order('rolnummer', { ascending: true })
  if (error) throw error
  return (data ?? []) as HuidigeRol[]
}

/**
 * Compacte samenvatting van een inkooporder-regel inclusief parent-IO en leverancier.
 * Bron voor het `<InkoopRegelSamenvatting>`-slot dat Reservering's `<RegelClaimDetail>`
 * kan inhangen — slot self-fetcht zodat de consumer alleen `ioRegelId` doorgeeft.
 */
export interface InkoopRegelSamenvatting {
  io_regel_id: number
  inkooporder_nr: string
  inkooporder_status: string
  leverancier_naam: string | null
  verwacht_datum: string | null
  te_leveren_m: number
  eenheid: string
}

// Supabase kan inkooporders/leveranciers als object OF array terugleveren afhankelijk
// van FK-config. Defensief beide vormen afhandelen.
type LevShape = { naam: string | null } | Array<{ naam: string | null }> | null
type IoShape = {
  inkooporder_nr: string | null
  status: string | null
  verwacht_datum: string | null
  leveranciers: LevShape
}
type RegelSamenvattingRow = {
  id: number
  te_leveren_m: number | null
  eenheid: string | null
  inkooporders: IoShape | IoShape[] | null
}

function normaliseerInkoopRegelSamenvatting(raw: RegelSamenvattingRow): InkoopRegelSamenvatting {
  const io = Array.isArray(raw.inkooporders) ? raw.inkooporders[0] ?? null : raw.inkooporders
  const lev = io?.leveranciers ?? null
  const leverancierNaam = Array.isArray(lev) ? lev[0]?.naam ?? null : lev?.naam ?? null

  return {
    io_regel_id: raw.id,
    inkooporder_nr: io?.inkooporder_nr ?? '',
    inkooporder_status: io?.status ?? '',
    leverancier_naam: leverancierNaam,
    verwacht_datum: io?.verwacht_datum ?? null,
    te_leveren_m: Number(raw.te_leveren_m ?? 0),
    eenheid: raw.eenheid ?? 'm',
  }
}

const SAMENVATTING_SELECT = `id, te_leveren_m, eenheid,
   inkooporders!inner (
     inkooporder_nr, status, verwacht_datum,
     leveranciers!inkooporders_leverancier_id_fkey ( naam )
   )`

export async function fetchInkoopRegelSamenvatting(
  ioRegelId: number,
): Promise<InkoopRegelSamenvatting | null> {
  const { data, error } = await supabase
    .from('inkooporder_regels')
    .select(SAMENVATTING_SELECT)
    .eq('id', ioRegelId)
    .single()

  if (error || !data) return null
  return normaliseerInkoopRegelSamenvatting(data as unknown as RegelSamenvattingRow)
}

/**
 * Batch-variant: één RPC met `.in('id', ioRegelIds)` voor meerdere regels tegelijk.
 * Bedoeld voor cross-Module-callers (bv. Reservering's RegelClaimDetail) die in één
 * popover meerdere IO-claim-rijen renderen — voorkomt N+1 round-trips.
 */
export async function fetchInkoopRegelSamenvattingen(
  ioRegelIds: number[],
): Promise<InkoopRegelSamenvatting[]> {
  if (ioRegelIds.length === 0) return []
  const { data, error } = await supabase
    .from('inkooporder_regels')
    .select(SAMENVATTING_SELECT)
    .in('id', ioRegelIds)

  if (error || !data) return []
  return (data as unknown as RegelSamenvattingRow[]).map(normaliseerInkoopRegelSamenvatting)
}
