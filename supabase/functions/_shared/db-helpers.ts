// Shared database helpers for snijplanning edge functions
// Used by: optimaliseer-snijplan, auto-plan-groep

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { SnijplanPiece, Roll, Placement } from './ffdh-packing.ts'
import { snijMargeCm } from './snij-marges.ts'

// ---------------------------------------------------------------------------
// Fetch snijplannen from the view
// ---------------------------------------------------------------------------

export interface FetchStukkenOptions {
  kwaliteitCode: string
  kleurCode: string
  statuses?: string[]  // default: ['Gepland']
  totDatum?: string | null
  /** Alleen stukken met afleverdatum STRIKT NA vanDatum (null-datums uitgesloten). */
  vanDatum?: string | null
}

export async function fetchStukken(
  supabase: SupabaseClient,
  options: FetchStukkenOptions,
): Promise<SnijplanPiece[]> {
  const { kwaliteitCode, kleurCode, totDatum, vanDatum } = options
  const statuses = options.statuses ?? ['Gepland']

  const kleurVariants = getKleurVariants(kleurCode)

  let query = supabase
    .from('snijplanning_overzicht')
    .select(
      'id, snij_lengte_cm, snij_breedte_cm, maatwerk_vorm, maatwerk_afwerking, order_nr, klant_naam, afleverdatum',
    )
    .in('status', statuses)
    .is('rol_id', null)
    .eq('kwaliteit_code', kwaliteitCode)
    .in('kleur_code', kleurVariants)

  if (totDatum) {
    query = query.or(`afleverdatum.lte.${totDatum},afleverdatum.is.null`)
  }
  if (vanDatum) {
    // Fill-up fase: alleen stukken met datum NA de horizon (null = geen datum → al in primaire fase)
    query = query.gt('afleverdatum', vanDatum)
  }

  const { data, error } = await query
  if (error) throw error

  return (data ?? []).map((sp: Record<string, unknown>) => {
    // Snij-marge ophogen t.o.v. nominale maat: ZO-afwerking +6 cm, rond/ovaal
    // +5 cm. De nominale maat in de view is wat de klant besteld heeft; de
    // packer moet met de fysieke snij-maat werken anders wordt een 120x120
    // ZO-stuk te krap geplaatst. De modal toont straks beide (besteld + placed).
    const marge = snijMargeCm(
      sp.maatwerk_afwerking as string | null,
      sp.maatwerk_vorm as string | null,
    )
    const lengte = (sp.snij_lengte_cm as number) + marge
    const breedte = (sp.snij_breedte_cm as number) + marge
    return {
      id: sp.id as number,
      lengte_cm: lengte,
      breedte_cm: breedte,
      maatwerk_vorm: sp.maatwerk_vorm as string | null,
      order_nr: sp.order_nr as string | null,
      klant_naam: sp.klant_naam as string | null,
      afleverdatum: sp.afleverdatum as string | null,
      area_cm2: lengte * breedte,
    }
  })
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
    .select('id, rolnummer, lengte_cm, breedte_cm, status, oppervlak_m2, kwaliteit_code, snijden_gestart_op')
    .in('status', ['beschikbaar', 'reststuk', 'in_snijplan'])
    .or(orClause)

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
  paren: KwaliteitKleurPair[],
): Promise<Map<number, Placement[]>> {
  if (paren.length === 0) return new Map()

  const expanded = expandKleurVarianten(paren)
  const orClause = expanded
    .map((p) => `and(kwaliteit_code.eq.${p.kwaliteit_code},kleur_code.eq.${p.kleur_code})`)
    .join(',')

  const { data: rolRows, error: rolError } = await supabase
    .from('rollen')
    .select('id')
    .eq('status', 'in_snijplan')
    .is('snijden_gestart_op', null)
    .or(orClause)
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
