// Shared database helpers for snijplanning edge functions
// Used by: optimaliseer-snijplan, auto-plan-groep

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { SnijplanPiece, Roll, Placement } from './ffdh-packing.ts'

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
      'id, snij_lengte_cm, snij_breedte_cm, maatwerk_vorm, order_nr, klant_naam, afleverdatum',
    )
    .in('status', statuses)
    .is('rol_id', null)
    .eq('kwaliteit_code', kwaliteitCode)
    .in('kleur_code', kleurVariants)

  if (totDatum) {
    query = query.or(`afleverdatum.lte.${totDatum},afleverdatum.is.null`)
  }

  const { data, error } = await query
  if (error) throw error

  return (data ?? []).map((sp: Record<string, unknown>) => ({
    id: sp.id as number,
    lengte_cm: sp.snij_lengte_cm as number,
    breedte_cm: sp.snij_breedte_cm as number,
    maatwerk_vorm: sp.maatwerk_vorm as string | null,
    order_nr: sp.order_nr as string | null,
    klant_naam: sp.klant_naam as string | null,
    afleverdatum: sp.afleverdatum as string | null,
    area_cm2: (sp.snij_lengte_cm as number) * (sp.snij_breedte_cm as number),
  }))
}

// ---------------------------------------------------------------------------
// Fetch available rolls (with interchangeable kwaliteiten + kleur variants)
// ---------------------------------------------------------------------------

export async function fetchUitwisselbareCodes(
  supabase: SupabaseClient,
  kwaliteitCode: string,
): Promise<string[]> {
  const { data: kwaliteit } = await supabase
    .from('kwaliteiten')
    .select('code, collectie_id')
    .eq('code', kwaliteitCode)
    .maybeSingle()

  let codes = [kwaliteitCode]
  if (kwaliteit?.collectie_id) {
    const { data: verwant } = await supabase
      .from('kwaliteiten')
      .select('code')
      .eq('collectie_id', kwaliteit.collectie_id)
    if (verwant) {
      codes = verwant.map((k: { code: string }) => k.code)
    }
  }
  return codes
}

// Fijnmazige uitwisselbaarheid (Map1.xlsx → kwaliteit_kleur_uitwisselgroepen).
// Geeft de set van (kwaliteit_code, kleur_code)-paren die onderling uitwisselbaar
// zijn voor snijplanning. Valt leeg terug als het input-paar niet in de tabel
// staat — de aanroeper gebruikt dan het collectie-pad.
export interface KwaliteitKleurPair {
  kwaliteit_code: string
  kleur_code: string
}

export async function fetchUitwisselbarePairs(
  supabase: SupabaseClient,
  kwaliteitCode: string,
  kleurCode: string,
): Promise<KwaliteitKleurPair[]> {
  const kleurVariants = getKleurVariants(kleurCode)
  const { data, error } = await supabase
    .from('kwaliteit_kleur_uitwisselbaar')
    .select('uitwissel_kwaliteit_code, uitwissel_kleur_code')
    .eq('input_kwaliteit_code', kwaliteitCode)
    .in('input_kleur_code', kleurVariants)

  if (error) throw error
  if (!data || data.length === 0) return []

  const seen = new Set<string>()
  const pairs: KwaliteitKleurPair[] = []
  for (const row of data as Array<Record<string, string>>) {
    const kw = row.uitwissel_kwaliteit_code
    const kl = row.uitwissel_kleur_code
    const k = `${kw}|${kl}`
    if (seen.has(k)) continue
    seen.add(k)
    pairs.push({ kwaliteit_code: kw, kleur_code: kl })
  }
  return pairs
}

export function getKleurVariants(kleurCode: string): string[] {
  const variants = [kleurCode]
  if (!kleurCode.includes('.')) variants.push(`${kleurCode}.0`)
  if (kleurCode.endsWith('.0')) variants.push(kleurCode.replace('.0', ''))
  return variants
}

export async function fetchBeschikbareRollen(
  supabase: SupabaseClient,
  uitwisselbareCodes: string[],
  kleurVariants: string[],
  kwaliteitCode: string,
  uitwisselbarePairs?: KwaliteitKleurPair[],
): Promise<Roll[]> {
  // Inclusief rollen met status in_snijplan die nog niet in productie zijn,
  // zodat nieuwe stukken in hun bestaande shelf-gaps kunnen landen.
  let query = supabase
    .from('rollen')
    .select('id, rolnummer, lengte_cm, breedte_cm, status, oppervlak_m2, kwaliteit_code, snijden_gestart_op')
    .in('status', ['beschikbaar', 'reststuk', 'in_snijplan'])

  if (uitwisselbarePairs && uitwisselbarePairs.length > 0) {
    // Fijnmazig: OR over expliciete (kwaliteit,kleur)-paren
    const orClause = uitwisselbarePairs
      .map((p) => `and(kwaliteit_code.eq.${p.kwaliteit_code},kleur_code.eq.${p.kleur_code})`)
      .join(',')
    query = query.or(orClause)
  } else {
    query = query.in('kwaliteit_code', uitwisselbareCodes).in('kleur_code', kleurVariants)
  }

  const { data: rollen, error } = await query

  if (error) throw error

  return (rollen ?? [])
    .filter((r: Record<string, unknown>) => {
      // Rollen die al in productie zijn (snijden_gestart_op gezet) blijven buiten
      // de pool — hun cutlist is bevroren.
      if (r.status === 'in_snijplan' && r.snijden_gestart_op !== null) return false
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
    }))
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
 * de stukken naar 'Snijden' en verdwijnen ze uit deze set.
 */
export async function fetchBezettePlaatsingen(
  supabase: SupabaseClient,
  uitwisselbareCodes: string[],
  kleurVariants: string[],
  uitwisselbarePairs?: KwaliteitKleurPair[],
): Promise<Map<number, Placement[]>> {
  let rolQuery = supabase
    .from('rollen')
    .select('id')
    .eq('status', 'in_snijplan')
    .is('snijden_gestart_op', null)

  if (uitwisselbarePairs && uitwisselbarePairs.length > 0) {
    const orClause = uitwisselbarePairs
      .map((p) => `and(kwaliteit_code.eq.${p.kwaliteit_code},kleur_code.eq.${p.kleur_code})`)
      .join(',')
    rolQuery = rolQuery.or(orClause)
  } else {
    rolQuery = rolQuery.in('kwaliteit_code', uitwisselbareCodes).in('kleur_code', kleurVariants)
  }

  const { data: rolRows, error: rolError } = await rolQuery
  if (rolError) throw rolError

  const rolIds = (rolRows ?? []).map((r: { id: number }) => r.id)
  if (rolIds.length === 0) return new Map()

  const { data, error } = await supabase
    .from('snijplannen')
    .select('id, rol_id, positie_x_cm, positie_y_cm, lengte_cm, breedte_cm, geroteerd')
    .in('rol_id', rolIds)
    .eq('status', 'Gepland')
    .not('positie_x_cm', 'is', null)
    .not('positie_y_cm', 'is', null)

  if (error) throw error

  const map = new Map<number, Placement[]>()
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
