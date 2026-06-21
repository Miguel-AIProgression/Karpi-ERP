// Shared database helpers for snijplanning edge functions
// Used by: optimaliseer-snijplan, auto-plan-groep, check-levertijd

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { SnijplanPiece, Roll, Placement, FifoMetrics, FifoOptions } from './ffdh-packing.ts'
import { ROL_FYSIEK_BEZET } from './snijplan-status.ts'

// ---------------------------------------------------------------------------
// Kleur-code variants — DB heeft historisch zowel "12" als "12.0" gangbaar
// (Excel-import bewaart trailing .0). Tot we de kolom zelf normaliseren,
// moet elke gelijkheidsfilter de twee varianten naast elkaar accepteren.
// ---------------------------------------------------------------------------

export function getKleurVariants(kleurCode: string): string[] {
  const variants = [kleurCode]
  if (!kleurCode.includes('.')) variants.push(`${kleurCode}.0`)
  if (kleurCode.endsWith('.0')) variants.push(kleurCode.replace(/\.0$/, ''))
  return variants
}

// ---------------------------------------------------------------------------
// Fetch snijplannen from the view
// ---------------------------------------------------------------------------

export interface FetchStukkenOptions {
  kwaliteitCode: string
  kleurCode: string
  statuses?: string[]  // default: ['Gepland']
  totDatum?: string | null
}

export async function fetchStukken(
  supabase: SupabaseClient,
  options: FetchStukkenOptions,
): Promise<SnijplanPiece[]> {
  const { kwaliteitCode, kleurCode, totDatum } = options
  const statuses = options.statuses ?? ['Gepland']

  const kleurVariants = getKleurVariants(kleurCode)

  let query = supabase
    .from('snijplanning_overzicht')
    .select(
      'id, placed_lengte_cm, placed_breedte_cm, maatwerk_vorm, order_nr, klant_naam, afleverdatum, express',
    )
    .in('status', statuses)
    .is('rol_id', null)
    .eq('kwaliteit_code', kwaliteitCode)
    .in('kleur_code', kleurVariants)
    // R5 (productie-only): stukken die uit een standaard-maat kleed gesneden
    // worden verbruiken geen rollengte → niet aan de packer aanbieden. Ze blijven
    // wel als snijplan bestaan (zichtbaar in snijplanning + confectie). De kolom
    // komt uit snijplanning_overzicht (mig 331), is BOOLEAN NOT NULL DEFAULT false.
    .eq('snijden_uit_standaardmaat', false)

  if (totDatum) {
    query = query.or(`afleverdatum.lte.${totDatum},afleverdatum.is.null`)
  }

  const { data, error } = await query
  if (error) throw error

  // placed_* uit de view heeft de snij-marge al toegepast (mig 233:
  // stuk_snij_marge_cm). De packer plaatst de fysieke snij-maat; modal
  // toont nominaal vs. placed via marge_cm-kolom.
  return (data ?? []).map((sp: Record<string, unknown>) => {
    const lengte = sp.placed_lengte_cm as number
    const breedte = sp.placed_breedte_cm as number
    return {
      id: sp.id as number,
      lengte_cm: lengte,
      breedte_cm: breedte,
      maatwerk_vorm: sp.maatwerk_vorm as string | null,
      order_nr: sp.order_nr as string | null,
      klant_naam: sp.klant_naam as string | null,
      afleverdatum: sp.afleverdatum as string | null,
      area_cm2: lengte * breedte,
      express: (sp.express as boolean | null) ?? false,
    }
  })
}

// ---------------------------------------------------------------------------
// Oude rol-toewijzing vóór release (Fase 2, mig 450) — de "vóór"-foto die
// auto-plan-groep na het packen vergelijkt met de "na"-foto om verdringing te
// detecteren: een stuk dat hier een echte rol had maar straks nergens als
// geplaatst voorkomt, is verdrongen.
// ---------------------------------------------------------------------------

export interface OudeRolToewijzing {
  rolId: number
  orderId: number
  orderNr: string | null
  snijplanNr: string | null
  afleverdatum: string | null
  leverType: 'week' | 'datum'
}

export async function fetchOudeRolToewijzingen(
  supabase: SupabaseClient,
  kwaliteitCode: string,
  kleurCode: string,
): Promise<Map<number, OudeRolToewijzing>> {
  const kleurVariants = getKleurVariants(kleurCode)

  const { data, error } = await supabase
    .from('snijplanning_overzicht')
    .select('id, rol_id, order_id, order_nr, snijplan_nr, afleverdatum, lever_type')
    .eq('status', 'Gepland')
    .not('rol_id', 'is', null)
    .eq('kwaliteit_code', kwaliteitCode)
    .in('kleur_code', kleurVariants)

  if (error) throw error

  const map = new Map<number, OudeRolToewijzing>()
  for (const sp of (data ?? []) as Array<Record<string, unknown>>) {
    map.set(sp.id as number, {
      rolId: sp.rol_id as number,
      orderId: sp.order_id as number,
      orderNr: (sp.order_nr as string | null) ?? null,
      snijplanNr: (sp.snijplan_nr as string | null) ?? null,
      afleverdatum: (sp.afleverdatum as string | null) ?? null,
      leverType: ((sp.lever_type as string | null) ?? 'week') as 'week' | 'datum',
    })
  }
  return map
}

// ---------------------------------------------------------------------------
// Uitwisselbare (kwaliteit, kleur)-paren via canonieke RPC
// ---------------------------------------------------------------------------

// Een uitwissel-paar zoals teruggegeven door `uitwisselbare_paren()` (migratie
// 138/140). `kleur_code` is altijd genormaliseerd (".0"-suffix gestript). Voor
// joining op `rollen.kleur_code` (die nog "12" of "12.0" kan zijn) moet de
// caller alle varianten meenemen — `expandKleurVarianten()` doet dat.
export interface KwaliteitKleurPair {
  kwaliteit_code: string
  kleur_code: string  // ALTIJD genormaliseerd
  is_zelf?: boolean
}

/**
 * Haal alle uitwisselbare (kwaliteit, kleur)-paren voor de input op via de
 * canonieke RPC. Vervangt de oude fallback-cascade (Map1 → collectie → self).
 *
 * Resolver in SQL: zelfde `kwaliteiten.collectie_id` + genormaliseerde
 * kleur-code. Self-row gegarandeerd aanwezig.
 */
export async function fetchUitwisselbareParen(
  supabase: SupabaseClient,
  kwaliteitCode: string,
  kleurCode: string,
): Promise<KwaliteitKleurPair[]> {
  const { data, error } = await supabase.rpc('uitwisselbare_paren', {
    p_kwaliteit_code: kwaliteitCode,
    p_kleur_code: kleurCode,
  })
  if (error) throw error

  return (data ?? []).map((row: Record<string, unknown>) => ({
    kwaliteit_code: row.target_kwaliteit_code as string,
    kleur_code: row.target_kleur_code as string,
    is_zelf: row.is_zelf as boolean,
  }))
}

/**
 * Helper: een genormaliseerd paar uitbreiden naar alle kleur-varianten die in
 * `rollen.kleur_code` of `producten.kleur_code` kunnen voorkomen ("12" en
 * "12.0"). Nodig zolang die kolom niet zelf genormaliseerd is.
 */
function expandKleurVarianten(paren: KwaliteitKleurPair[]): KwaliteitKleurPair[] {
  const out: KwaliteitKleurPair[] = []
  const seen = new Set<string>()
  for (const p of paren) {
    const variants = p.kleur_code.includes('.') ? [p.kleur_code] : [p.kleur_code, `${p.kleur_code}.0`]
    for (const kl of variants) {
      const key = `${p.kwaliteit_code}|${kl}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ kwaliteit_code: p.kwaliteit_code, kleur_code: kl })
    }
  }
  return out
}

export async function fetchBeschikbareRollen(
  supabase: SupabaseClient,
  paren: KwaliteitKleurPair[],
  kwaliteitCode: string,
): Promise<Roll[]> {
  if (paren.length === 0) return []

  // Inclusief rollen met status in_snijplan die nog niet in productie zijn,
  // zodat nieuwe stukken in hun bestaande shelf-gaps kunnen landen.
  const expanded = expandKleurVarianten(paren)
  const orClause = expanded
    .map((p) => `and(kwaliteit_code.eq.${p.kwaliteit_code},kleur_code.eq.${p.kleur_code})`)
    .join(',')

  const { data: rollen, error } = await supabase
    .from('rollen')
    .select('id, rolnummer, lengte_cm, breedte_cm, status, oppervlak_m2, kwaliteit_code, snijden_gestart_op, in_magazijn_sinds')
    .in('status', ['beschikbaar', 'reststuk', 'in_snijplan'])
    .or(orClause)

  if (error) throw error

  // Defense-in-depth: rollen waarop al een snijplan in 'Snijden' of 'Gesneden'
  // staat zijn fysiek bevroren — operator is bezig of klaar. `snijden_gestart_op`
  // is de primaire indicator, maar er bestaat een window (en historische data)
  // waar `snijplannen.status` al doorgeschoven is naar 'Snijden' terwijl
  // `rollen.snijden_gestart_op` nog NULL is; dan kwam de rol toch in de pool en
  // pakte de packer er fysiek overlappende stukken bovenop (zie VERR130 C, mei
  // 2026: 4 snijplannen op (0,0) door tweede planning-run die de eerste niet
  // zag). Tweede query haalt de rol-IDs op die we hard moeten uitsluiten.
  const { data: bezigeRolRows, error: bezigError } = await supabase
    .from('snijplannen')
    .select('rol_id')
    .in('status', [...ROL_FYSIEK_BEZET])
    .not('rol_id', 'is', null)
  if (bezigError) throw bezigError
  const bezigeRolIds = new Set<number>(
    ((bezigeRolRows ?? []) as Array<{ rol_id: number | null }>)
      .map((r) => r.rol_id)
      .filter((id): id is number => id !== null),
  )

  return (rollen ?? [])
    .filter((r: Record<string, unknown>) => {
      // Rollen die al in productie zijn (snijden_gestart_op gezet) blijven buiten
      // de pool — hun cutlist is bevroren.
      if (r.status === 'in_snijplan' && r.snijden_gestart_op !== null) return false
      // Extra guard (zie comment boven query): rol met Snijden/Gesneden-snijplannen
      // mag nooit door auto-plan-groep opnieuw gepackt worden.
      if (bezigeRolIds.has(r.id as number)) return false
      // Placeholder-rollen (PH-*, lengte/breedte = 0) staan in de voorraad als
      // stub voor inkoop-signalering — ze hebben geen fysiek tapijt. Sluit ze
      // uit van de packing-pool, anders blokkeren ze de loop (sort zet ze
      // vooraan, ze accepteren niks, en afhankelijk van sortering wordt een
      // echte rol soms niet eens geprobeerd).
      const lengte = Number(r.lengte_cm ?? 0)
      const breedte = Number(r.breedte_cm ?? 0)
      if (lengte <= 0 || breedte <= 0) return false
      return true
    })
    .map((r: Record<string, unknown>) => ({
      id: r.id as number,
      rolnummer: r.rolnummer as string,
      lengte_cm: r.lengte_cm as number,
      breedte_cm: r.breedte_cm as number,
      status: r.status as string,
      oppervlak_m2: r.oppervlak_m2 as number,
      sort_priority: (r.status as string) === 'reststuk' ? 1 : 2,
      is_exact: (r.kwaliteit_code as string) === kwaliteitCode,
      has_existing_placements: (r.status as string) === 'in_snijplan',
      in_magazijn_sinds: (r.in_magazijn_sinds as string | null) ?? null,
    }))
}

// ---------------------------------------------------------------------------
// C1: rol-ids die al voor een ander (goedgekeurd) snijvoorstel gereserveerd
// zijn. De FIFO-voorkeur mag deze niet als nieuwe aansnijding naar voren halen
// (geen verdringing). ADR-0021.
// ---------------------------------------------------------------------------

/**
 * Bouw de FIFO-opties (ADR-0021) uit app_config.snijplanning + vandaag +
 * gereserveerde rol-ids. Defaults spiegelen mig 283.
 */
export async function buildFifoOptions(
  supabase: SupabaseClient,
): Promise<FifoOptions> {
  const { data } = await supabase
    .from('app_config')
    .select('waarde')
    .eq('sleutel', 'snijplanning')
    .maybeSingle()
  const w = (data?.waarde ?? {}) as Record<string, unknown>
  const num = (k: string, def: number) =>
    typeof w[k] === 'number' ? (w[k] as number) : def

  const gereserveerdeRolIds = await fetchGereserveerdeRolIds(supabase)
  const modus = w.modus === 'geavanceerd' ? 'geavanceerd' : 'simpel'

  return {
    modus,
    drempelDagen: num('drempel_dagen', 90),
    hardeBovengrensDagen: num('harde_bovengrens_dagen', 180),
    alpha: num('alpha', 0.05),
    vandaag: new Date().toISOString().slice(0, 10),
    badgeGeelM2: num('badge_geel_m2', 5),
    badgeGeelPct: num('badge_geel_pct', 25),
    badgeRoodM2: num('badge_rood_m2', 10),
    badgeRoodPct: num('badge_rood_pct', 50),
    gereserveerdeRolIds,
  }
}

export async function fetchGereserveerdeRolIds(
  supabase: SupabaseClient,
): Promise<Set<number>> {
  const { data, error } = await supabase
    .from('snijvoorstel_plaatsingen')
    .select('rol_id, snijvoorstellen!inner(status)')
    .eq('snijvoorstellen.status', 'goedgekeurd')

  if (error) throw error

  const ids = new Set<number>()
  for (const row of (data ?? []) as Array<{ rol_id: number | null }>) {
    if (row.rol_id != null) ids.add(row.rol_id)
  }
  return ids
}

// ---------------------------------------------------------------------------
// Fetch bestaande Snijden-plaatsingen per rol (voor shelf-reconstructie)
// ---------------------------------------------------------------------------

/**
 * Haal alle Gepland-stukken op die al aan een rol gekoppeld zijn in deze
 * kwaliteit/kleur-groep. Gebruikt voor shelf-reconstructie: nieuwe stukken
 * kunnen in bestaande shelf-gaps landen i.p.v. een nieuwe rol aan te snijden.
 *
 * Status 'Gepland' impliceert al dat de rol nog niet fysiek gestart is
 * (na migratie 086). Zodra `start_snijden_rol` wordt aangeroepen promoveren
 * de stukken naar 'Snijden' en verdwijnen ze uit deze set — maar dan zou de
 * rol zelf ook al uit `fetchBeschikbareRollen` gefilterd moeten zijn (zowel
 * via `snijden_gestart_op` als via de Snijden/Gesneden-rol-ID guard). Als
 * beide kanten klopt zien we Snijden-stukken hier dus nooit; de explicit
 * 'Gepland'-filter blijft staan om eventuele state-drift veilig te falen.
 */
export async function fetchBezettePlaatsingen(
  supabase: SupabaseClient,
  paren: KwaliteitKleurPair[],
): Promise<Map<number, Placement[]>> {
  if (paren.length === 0) return new Map()

  const expanded = expandKleurVarianten(paren)
  const orClause = expanded
    .map((p) => `and(kwaliteit_code.eq.${p.kwaliteit_code},kleur_code.eq.${p.kleur_code})`)
    .join(',')

  const map = new Map<number, Placement[]>()

  const { data: rolRows, error: rolError } = await supabase
    .from('rollen')
    .select('id')
    .eq('status', 'in_snijplan')
    .is('snijden_gestart_op', null)
    .or(orClause)
  if (rolError) throw rolError

  const rolIds = (rolRows ?? []).map((r: { id: number }) => r.id)

  // Bestaande, in een voorstel geplande snijplannen op deze rollen.
  if (rolIds.length > 0) {
    const { data, error } = await supabase
      .from('snijplannen')
      .select('id, rol_id, positie_x_cm, positie_y_cm, lengte_cm, breedte_cm, geroteerd')
      .in('rol_id', rolIds)
      .eq('status', 'Gepland')
      .not('positie_x_cm', 'is', null)
      .not('positie_y_cm', 'is', null)
    if (error) throw error

    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const rolId = row.rol_id as number
      const geroteerd = (row.geroteerd as boolean) ?? false
      // snijplannen.lengte_cm/breedte_cm zijn de oorspronkelijke stukmaten.
      // In tryPlacePiece is de niet-geroteerde orientatie {w: piece.lengte_cm,
      // h: piece.breedte_cm} → placement.lengte_cm = X (w), placement.breedte_cm
      // = Y (h). Bij rotatie worden ze omgedraaid.
      const placement: Placement = {
        snijplan_id: row.id as number,
        positie_x_cm: Number(row.positie_x_cm),
        positie_y_cm: Number(row.positie_y_cm),
        lengte_cm: geroteerd ? Number(row.breedte_cm) : Number(row.lengte_cm),
        breedte_cm: geroteerd ? Number(row.lengte_cm) : Number(row.breedte_cm),
        geroteerd,
      }
      const arr = map.get(rolId) ?? []
      arr.push(placement)
      map.set(rolId, arr)
    }
  }

  // ---------------------------------------------------------------------------
  // Migratie-blokkeringen (ADR-0028, mig 313): oud-systeem maatwerk-orders die
  // nog gesneden moeten worden, beslaan FIFO-lengte op rollen. We injecteren per
  // geraakte rol één full-width bodemstrip zodat de packer er niet overheen
  // plant. Let op: deze rollen hebben meestal status 'beschikbaar'/'reststuk'
  // (NIET 'in_snijplan'), dus de in_snijplan-query hierboven mist ze — aparte
  // query op de hele kwaliteit/kleur-groep. Draait ALTIJD, ook als er geen
  // in_snijplan-rollen zijn (anders zou een groep zonder voorstel-rollen de
  // blokkering missen). Een rol die zowel 'in_snijplan' is als een blokkering
  // heeft, krijgt bewust beide (echte plaatsing + strip); computeFreeRects
  // trekt overlappende obstakels correct af (subtractRect), dus geen dubbeltel.
  // ---------------------------------------------------------------------------
  const { data: groepRollen, error: groepError } = await supabase
    .from('rollen')
    .select('id, breedte_cm, lengte_cm')
    .in('status', ['beschikbaar', 'reststuk', 'in_snijplan'])
    .or(orClause)
  if (groepError) throw groepError

  const rolMeta = new Map<number, { breedte: number; lengte: number }>()
  for (const r of (groepRollen ?? []) as Array<Record<string, unknown>>) {
    rolMeta.set(r.id as number, {
      breedte: Number(r.breedte_cm ?? 0),
      lengte: Number(r.lengte_cm ?? 0),
    })
  }

  const groepRolIds = [...rolMeta.keys()]
  if (groepRolIds.length > 0) {
    const { data: blok, error: blokError } = await supabase
      .from('migratie_blokkering')
      .select('rol_id, gereserveerde_lengte_cm')
      .eq('status', 'actief')
      .in('rol_id', groepRolIds)
    if (blokError) throw blokError

    const lengtePerRol = new Map<number, number>()
    for (const b of (blok ?? []) as Array<Record<string, unknown>>) {
      const rolId = b.rol_id as number
      lengtePerRol.set(
        rolId,
        (lengtePerRol.get(rolId) ?? 0) + Number(b.gereserveerde_lengte_cm),
      )
    }

    for (const [rolId, lengte] of lengtePerRol) {
      const meta = rolMeta.get(rolId)
      if (!meta || meta.breedte <= 0 || meta.lengte <= 0) continue
      // Strip nooit groter dan de rol zelf (defensief tegen overgeboekte data).
      const stripY = Math.min(lengte, meta.lengte)
      const strip: Placement = {
        snijplan_id: -rolId, // negatief: geen botsing met echte snijplan-ids
        positie_x_cm: 0,
        positie_y_cm: 0,
        lengte_cm: meta.breedte, // X-extent = volle rolbreedte
        breedte_cm: stripY, // Y-extent = verbruikte lengte
        geroteerd: false,
      }
      const arr = map.get(rolId) ?? []
      arr.push(strip)
      map.set(rolId, arr)
    }
  }

  return map
}

// ---------------------------------------------------------------------------
// Save voorstel + plaatsingen to database
// ---------------------------------------------------------------------------

export interface SaveVoorstelOptions {
  kwaliteitCode: string
  kleurCode: string
  totaalStukken: number
  totaalRollen: number
  totaalM2Gebruikt: number
  totaalM2Afval: number
  afvalPercentage: number
  aangemaakt_door?: string
  /** FIFO-badge & vergelijkingsmetrics (ADR-0021, mig 284). */
  fifo?: FifoMetrics
}

/**
 * Insert-with-retry voor voorstel_nr unique collisions. Zonder dit vangnet
 * leidt één out-of-sync `volgend_nummer`-counter tot een volledig gefaalde
 * herplan-run over 100+ groepen. Met retry probeert de functie MAX_RETRIES×
 * opnieuw een nieuw nummer op te halen voordat 'ie opgeeft — in de praktijk
 * is 1 retry voldoende omdat de self-healing functie dan de echte max ziet
 * (het net gefaalde nummer zit niet in snijvoorstellen want de insert rolled
 * back) en MAX+1 teruggeeft.
 */
export async function saveVoorstel(
  supabase: SupabaseClient,
  options: SaveVoorstelOptions,
  plaatsingen: Array<{
    rol_id: number
    snijplan_id: number
    positie_x_cm: number
    positie_y_cm: number
    lengte_cm: number
    breedte_cm: number
    geroteerd: boolean
  }>,
): Promise<{ voorstel_id: number; voorstel_nr: string }> {
  const MAX_RETRIES = 10
  let lastError: unknown = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Get next voorstel number
    const { data: nrData, error: nrError } = await supabase.rpc(
      'volgend_nummer',
      { p_type: 'SNIJV' },
    )
    if (nrError) throw nrError
    const voorstel_nr = nrData as string

    // Insert voorstel
    const { data: voorstel, error: vsError } = await supabase
      .from('snijvoorstellen')
      .insert({
        voorstel_nr,
        kwaliteit_code: options.kwaliteitCode,
        kleur_code: options.kleurCode,
        totaal_stukken: options.totaalStukken,
        totaal_rollen: options.totaalRollen,
        totaal_m2_gebruikt: Math.round(options.totaalM2Gebruikt * 100) / 100,
        totaal_m2_afval: Math.round(options.totaalM2Afval * 100) / 100,
        afval_percentage: options.afvalPercentage,
        status: 'concept',
        ...(options.aangemaakt_door ? { aangemaakt_door: options.aangemaakt_door } : {}),
        ...(options.fifo
          ? {
              fifo_badge: options.fifo.badge,
              extra_afval_m2: options.fifo.extra_afval_m2,
              extra_afval_pct: options.fifo.extra_afval_pct,
              oudste_rol_dagen: options.fifo.oudste_rol_dagen,
              efficient_oudste_rol_dagen: options.fifo.efficient_oudste_rol_dagen,
              rolwissels: options.fifo.rolwissels,
              efficient_rolwissels: options.fifo.efficient_rolwissels,
              fifo_rationale: {
                reden: options.fifo.reden,
                rollen: options.fifo.rationale,
              },
            }
          : {}),
      })
      .select('id')
      .single()

    if (!vsError) {
      const voorstel_id = voorstel.id
      if (plaatsingen.length > 0) {
        const { error: plError } = await supabase
          .from('snijvoorstel_plaatsingen')
          .insert(plaatsingen.map(p => ({ voorstel_id, ...p })))
        if (plError) throw plError
      }
      return { voorstel_id, voorstel_nr }
    }

    // Duplicate voorstel_nr? Retry met een nieuw nummer — de self-healing
    // functie compenseert automatisch omdat het gefaalde nummer niet in de
    // tabel terecht komt (transactie rolled back).
    const isDuplicateVoorstelNr =
      (vsError as { code?: string }).code === '23505' &&
      (vsError.message?.includes('voorstel_nr') ||
        (vsError as { details?: string }).details?.includes('voorstel_nr'))

    if (!isDuplicateVoorstelNr) throw vsError
    lastError = vsError

    // Exponential-backoff delay + force-bump counter boven de echte max zodat
    // retry gegarandeerd een nieuw nummer krijgt.
    if (attempt < MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, 50 * attempt))
    }
  }

  throw new Error(
    `saveVoorstel: ${MAX_RETRIES} retries uitgeput — counter blijft out-of-sync. Laatste fout: ${JSON.stringify(lastError)}`,
  )
}

// ---------------------------------------------------------------------------
// Openstaande rol-inkoop voor de "Wacht op inkoop"-claim (mig 437/438).
// Matching = exacte kwaliteit_code + kleur_code (plan-scope: geen cross-
// kwaliteit/kleur-substitutie via inkoop in v1) — een kwaliteit heeft vaak
// tientallen kleuren in dezelfde inkooporder; zonder kleur-filter claimt de
// packer per ongeluk de verkeerde kleur (bug gevonden via CISC 48: matchte
// op kleur 24 i.p.v. 48, simpelweg omdat die regel een eerdere verwacht_datum
// + lagere regel_id had). FIFO-volgorde spiegelt herallocateer_orderregel:
// verwacht_datum ASC NULLS LAST, regel_id ASC.
// ---------------------------------------------------------------------------

export interface OpenInkoopRegel {
  regel_id: number
  inkooporder_nr: string
  leverancier_naam: string | null
  verwacht_datum: string | null
  te_leveren_m: number
}

export async function fetchOpenInkoopRegels(
  supabase: SupabaseClient,
  kwaliteitCode: string,
  kleurCode: string,
): Promise<OpenInkoopRegel[]> {
  const kleurVariants = getKleurVariants(kleurCode)
  const { data, error } = await supabase
    .from('openstaande_inkooporder_regels')
    .select('regel_id, inkooporder_nr, leverancier_naam, verwacht_datum, te_leveren_m')
    .eq('eenheid', 'm')
    .eq('kwaliteit_code', kwaliteitCode)
    .in('kleur_code', kleurVariants)
    .order('verwacht_datum', { ascending: true, nullsFirst: false })
    .order('regel_id', { ascending: true })

  if (error) throw error

  return (data ?? []).map((r: Record<string, unknown>) => ({
    regel_id: r.regel_id as number,
    inkooporder_nr: r.inkooporder_nr as string,
    leverancier_naam: (r.leverancier_naam as string | null) ?? null,
    verwacht_datum: (r.verwacht_datum as string | null) ?? null,
    te_leveren_m: Number(r.te_leveren_m ?? 0),
  }))
}

/** Standaard rolbreedte (cm) voor een kwaliteit — `null` als onbekend/0 (dan
 *  kan er geen virtuele rol gebouwd worden, zie auto-plan-groep). */
export async function fetchStandaardBreedte(
  supabase: SupabaseClient,
  kwaliteitCode: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from('kwaliteiten')
    .select('standaard_breedte_cm')
    .eq('code', kwaliteitCode)
    .maybeSingle()
  if (error) throw error

  const breedte = (data as { standaard_breedte_cm: number | null } | null)?.standaard_breedte_cm
  return typeof breedte === 'number' && breedte > 0 ? breedte : null
}

// ---------------------------------------------------------------------------
// Snijtijd per vorm (mig 460) — zie _shared/snijtijd.ts voor de pure functie.
// ---------------------------------------------------------------------------

/** Snijtijd-tarief (minuten) per vorm-code, uit `maatwerk_vormen`. */
export async function fetchVormSnijtijden(supabase: SupabaseClient): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('maatwerk_vormen')
    .select('code, snijtijd_minuten')
  if (error) throw error
  return new Map(
    ((data ?? []) as Array<{ code: string; snijtijd_minuten: number }>).map((r) => [r.code, Number(r.snijtijd_minuten)]),
  )
}

/** Kwaliteit-codes die moeilijk te snijden zijn — rechthoek telt voor hen als
 *  het algemene (niet-gekorte) tarief, zie bepaalSnijtijdMinuten. */
export async function fetchMoeilijkeKwaliteiten(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('kwaliteiten')
    .select('code')
    .eq('moeilijk_te_snijden', true)
  if (error) throw error
  return new Set(((data ?? []) as Array<{ code: string }>).map((r) => r.code))
}
