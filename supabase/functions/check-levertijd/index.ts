// Supabase Edge Function: check-levertijd
// Real-time leverdatum-berekening bij order-aanmaak.
//
// Stap 1: zoek match op bestaande snijplan-rol (uitwisselbare kwaliteit/kleur)
// Stap 2: geen match → check capaciteit + backlog voor nieuwe rol
// Stap 3: combineer tot scenario + onderbouwing
//
// Performance-doel: < 1.5s p95.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  fetchUitwisselbarePairs,
  fetchUitwisselbareCodes,
  getKleurVariants,
} from '../_shared/db-helpers.ts'
import {
  rolHeeftPlek,
  snijDatumVoorRol,
  kiesBesteMatch,
  plusKalenderDagen,
} from '../_shared/levertijd-match.ts'
import {
  capaciteitsCheck,
  snijWeekVoorLever,
  backlogIsVoldoende,
} from '../_shared/levertijd-capacity.ts'
import { resolveScenario } from '../_shared/levertijd-resolver.ts'
import {
  berekenSnijAgenda,
  STANDAARD_WERKTIJDEN,
  type RolAgendaInput,
} from '../_shared/werkagenda.ts'
import { evalueerSpoed } from '../_shared/spoed-check.ts'
import type {
  CheckLevertijdRequest,
  CheckLevertijdResponse,
  KandidaatRol,
  LevertijdConfig,
  PlanRecord,
  RolMatchKandidaat,
} from '../_shared/levertijd-types.ts'
import type { SnijplanPiece } from '../_shared/ffdh-packing.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Migratie 070 mapt 'Gepland'/'Wacht' → 'Snijden' (via trigger). Een snijplan dat
// al toegewezen is aan een rol heeft dus altijd status='Snijden' totdat het fysiek
// gesneden is (gesneden_datum gevuld).
const PLANNING_STATUS_IN_PIPELINE = ['Snijden']

// ---------------------------------------------------------------------------
// Config-fetch
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: LevertijdConfig = {
  logistieke_buffer_dagen: 2,
  backlog_minimum_m2: 12,
  capaciteit_per_week: 450,
  capaciteit_marge_pct: 0,
  wisseltijd_minuten: 15,
  snijtijd_minuten: 5,
  maatwerk_weken: 4,
  spoed_buffer_uren: 4,
  spoed_toeslag_bedrag: 50,
  spoed_product_id: 'SPOEDTOESLAG',
}

async function fetchConfig(supabase: SupabaseClient): Promise<LevertijdConfig> {
  const { data } = await supabase
    .from('app_config')
    .select('sleutel, waarde')
    .in('sleutel', ['productie_planning', 'order_config'])

  const cfg: LevertijdConfig = { ...DEFAULT_CONFIG }
  for (const row of (data ?? []) as Array<{ sleutel: string; waarde: Record<string, unknown> }>) {
    if (row.sleutel === 'productie_planning') {
      const w = row.waarde
      if (typeof w.capaciteit_per_week === 'number') cfg.capaciteit_per_week = w.capaciteit_per_week
      if (typeof w.capaciteit_marge_pct === 'number') cfg.capaciteit_marge_pct = w.capaciteit_marge_pct
      if (typeof w.wisseltijd_minuten === 'number') cfg.wisseltijd_minuten = w.wisseltijd_minuten
      if (typeof w.snijtijd_minuten === 'number') cfg.snijtijd_minuten = w.snijtijd_minuten
      if (typeof w.logistieke_buffer_dagen === 'number') cfg.logistieke_buffer_dagen = w.logistieke_buffer_dagen
      if (typeof w.backlog_minimum_m2 === 'number') cfg.backlog_minimum_m2 = w.backlog_minimum_m2
      if (typeof w.spoed_buffer_uren === 'number') cfg.spoed_buffer_uren = w.spoed_buffer_uren
      if (typeof w.spoed_toeslag_bedrag === 'number') cfg.spoed_toeslag_bedrag = w.spoed_toeslag_bedrag
      if (typeof w.spoed_product_id === 'string') cfg.spoed_product_id = w.spoed_product_id
    } else if (row.sleutel === 'order_config') {
      const w = row.waarde
      if (typeof w.maatwerk_weken === 'number') cfg.maatwerk_weken = w.maatwerk_weken
    }
  }
  return cfg
}

// ---------------------------------------------------------------------------
// Stap 1 datafetchers
// ---------------------------------------------------------------------------

async function fetchKandidaatRollen(
  supabase: SupabaseClient,
  uitwisselbareCodes: string[],
  kleurVariants: string[],
  uitwisselbarePairs: Array<{ kwaliteit_code: string; kleur_code: string }>,
  minSide: number,
): Promise<KandidaatRol[]> {
  let query = supabase
    .from('rollen')
    .select('id, rolnummer, lengte_cm, breedte_cm, status, kwaliteit_code, kleur_code')
    .in('status', ['in_snijplan', 'beschikbaar', 'reststuk'])
    .gte('lengte_cm', minSide)
    .gte('breedte_cm', minSide)

  if (uitwisselbarePairs.length > 0) {
    const orClause = uitwisselbarePairs
      .map((p) => `and(kwaliteit_code.eq.${p.kwaliteit_code},kleur_code.eq.${p.kleur_code})`)
      .join(',')
    query = query.or(orClause)
  } else {
    query = query.in('kwaliteit_code', uitwisselbareCodes).in('kleur_code', kleurVariants)
  }

  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as KandidaatRol[]
}

async function fetchBestaandePlaatsingen(
  supabase: SupabaseClient,
  rolIds: number[],
): Promise<PlanRecord[]> {
  if (rolIds.length === 0) return []
  // Embedded select: snijplannen.afleverdatum is altijd NULL in de praktijk;
  // de werkelijke leverdatum komt uit orders.afleverdatum via order_regels.
  const { data, error } = await supabase
    .from('snijplannen')
    .select('id, rol_id, positie_x_cm, positie_y_cm, lengte_cm, breedte_cm, geroteerd, planning_week, planning_jaar, status, order_regel:order_regels(orders(afleverdatum))')
    .in('rol_id', rolIds)
    .in('status', PLANNING_STATUS_IN_PIPELINE)
    .is('gesneden_datum', null)
  if (error) throw error

  // Many-to-one embed (snijplannen→order_regels→orders) returnt runtime een
  // object, maar PostgREST-types inferreren array. Normaliseer beide vormen.
  function unwrapEmbed<T>(v: T | T[] | null | undefined): T | null {
    if (Array.isArray(v)) return v[0] ?? null
    return v ?? null
  }

  return (data ?? []).map((r: Record<string, unknown>): PlanRecord => {
    const orderRegel = unwrapEmbed(r.order_regel as { orders: unknown } | { orders: unknown }[] | null)
    const order = orderRegel ? unwrapEmbed(orderRegel.orders as { afleverdatum: string | null } | { afleverdatum: string | null }[] | null) : null
    return {
      id: r.id as number,
      rol_id: r.rol_id as number,
      positie_x_cm: r.positie_x_cm as number,
      positie_y_cm: r.positie_y_cm as number,
      lengte_cm: r.lengte_cm as number,
      breedte_cm: r.breedte_cm as number,
      geroteerd: r.geroteerd as boolean,
      planning_week: r.planning_week as number | null,
      planning_jaar: r.planning_jaar as number | null,
      status: r.status as string,
      afleverdatum: order?.afleverdatum ?? null,
    }
  })
}

// ---------------------------------------------------------------------------
// Stap 2 datafetcher
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Werkagenda: bepaal werkelijke snij-datums voor alle wachtende rollen
// ---------------------------------------------------------------------------

async function fetchWerkagendaInput(
  supabase: SupabaseClient,
  cfg: LevertijdConfig,
): Promise<RolAgendaInput[]> {
  const { data, error } = await supabase
    .from('snijplannen')
    .select('rol_id, order_regel:order_regels(orders(afleverdatum))')
    .eq('status', 'Snijden')
    .not('rol_id', 'is', null)
    .is('gesneden_datum', null)
  if (error) throw error

  function unwrap<T>(v: T | T[] | null | undefined): T | null {
    if (Array.isArray(v)) return v[0] ?? null
    return v ?? null
  }

  const perRol = new Map<number, { stuks: number; vroegsteAfleverdatum: string | null }>()
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const rolId = r.rol_id as number
    const orderRegel = unwrap(r.order_regel as { orders: unknown } | { orders: unknown }[] | null)
    const order = orderRegel ? unwrap(orderRegel.orders as { afleverdatum: string | null } | { afleverdatum: string | null }[] | null) : null
    const afl = order?.afleverdatum ?? null
    const huidig = perRol.get(rolId) ?? { stuks: 0, vroegsteAfleverdatum: null }
    huidig.stuks++
    if (afl && (!huidig.vroegsteAfleverdatum || afl < huidig.vroegsteAfleverdatum)) {
      huidig.vroegsteAfleverdatum = afl
    }
    perRol.set(rolId, huidig)
  }

  return Array.from(perRol.entries()).map(([rolId, info]) => ({
    rolId,
    vroegsteAfleverdatum: info.vroegsteAfleverdatum,
    duurMinuten: cfg.wisseltijd_minuten + info.stuks * cfg.snijtijd_minuten,
  }))
}

async function fetchBacklog(
  supabase: SupabaseClient,
  kwaliteit: string,
  kleur: string,
): Promise<{ totaal_m2: number; aantal_stukken: number }> {
  // Probeer eerst de RPC (migratie 080)
  const rpc = await supabase.rpc('backlog_per_kwaliteit_kleur', {
    p_kwaliteit: kwaliteit,
    p_kleur: kleur,
  })
  if (!rpc.error && rpc.data && rpc.data.length > 0) {
    const r = rpc.data[0] as { totaal_m2: number; aantal_stukken: number }
    return { totaal_m2: Number(r.totaal_m2 ?? 0), aantal_stukken: Number(r.aantal_stukken ?? 0) }
  }

  // Fallback: directe view-query
  const kleurVariants = getKleurVariants(kleur)
  const { data } = await supabase
    .from('snijplanning_overzicht')
    .select('snij_lengte_cm, snij_breedte_cm')
    .eq('kwaliteit_code', kwaliteit)
    .in('kleur_code', kleurVariants)
    .eq('status', 'Wacht')
    .is('rol_id', null)

  const stukken = data ?? []
  const totaal_m2 = stukken.reduce((sum: number, r: { snij_lengte_cm: number; snij_breedte_cm: number }) => {
    return sum + (Number(r.snij_lengte_cm) * Number(r.snij_breedte_cm)) / 10000
  }, 0)
  return { totaal_m2, aantal_stukken: stukken.length }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  try {
    const body: CheckLevertijdRequest = await req.json()
    const { kwaliteit_code, kleur_code, lengte_cm, breedte_cm, vorm, gewenste_leverdatum } = body

    // ---- Validatie ----
    if (!kwaliteit_code || !kleur_code) {
      return jsonResponse({ error: 'kwaliteit_code en kleur_code zijn verplicht' }, 400)
    }
    if (!lengte_cm || !breedte_cm || lengte_cm <= 0 || breedte_cm <= 0) {
      return jsonResponse({ error: 'lengte_cm en breedte_cm moeten > 0 zijn' }, 400)
    }

    // ---- Config + uitwisselbaarheid parallel ----
    const [cfg, uitwisselbarePairs] = await Promise.all([
      fetchConfig(supabase),
      fetchUitwisselbarePairs(supabase, kwaliteit_code, kleur_code),
    ])

    const uitwisselbareCodes = uitwisselbarePairs.length > 0
      ? Array.from(new Set(uitwisselbarePairs.map((p) => p.kwaliteit_code)))
      : await fetchUitwisselbareCodes(supabase, kwaliteit_code)
    const kleurVariants = getKleurVariants(kleur_code)

    const minSide = Math.min(lengte_cm, breedte_cm)
    const nieuwStuk: SnijplanPiece = {
      id: -1,
      lengte_cm,
      breedte_cm,
      maatwerk_vorm: vorm ?? null,
      order_nr: null,
      klant_naam: null,
      afleverdatum: gewenste_leverdatum ?? null,
      area_cm2: lengte_cm * breedte_cm,
    }
    const nieuwStukM2 = (lengte_cm * breedte_cm) / 10000

    // ---- Fetch kandidaten + backlog + werkagenda parallel ----
    const [rollen, backlogRaw, agendaInput] = await Promise.all([
      fetchKandidaatRollen(supabase, uitwisselbareCodes, kleurVariants, uitwisselbarePairs, minSide),
      fetchBacklog(supabase, kwaliteit_code, kleur_code),
      fetchWerkagendaInput(supabase, cfg),
    ])

    // Werkagenda: bepaal voor elke wachtende rol wanneer die fysiek gesneden wordt.
    // Sorteert intern op vroegste afleverdatum + plant sequentieel binnen werktijden.
    // De `logistieke_buffer_dagen` bepaalt of een rol als `teLaat` wordt gemarkeerd
    // (snij-eind moet ≥ buffer dagen vóór leverdatum vallen).
    const werkagenda = berekenSnijAgenda(agendaInput, STANDAARD_WERKTIJDEN, new Date(), cfg.logistieke_buffer_dagen)

    const geenRolPassend = rollen.length === 0

    // ---- Stap 1: Match op bestaande rol ----
    const rolIds = rollen.map((r) => r.id)
    const bestaande = await fetchBestaandePlaatsingen(supabase, rolIds)
    const bestaandePerRol = new Map<number, PlanRecord[]>()
    for (const p of bestaande) {
      const list = bestaandePerRol.get(p.rol_id) ?? []
      list.push(p)
      bestaandePerRol.set(p.rol_id, list)
    }

    const kandidaten: RolMatchKandidaat[] = []
    for (const rol of rollen) {
      const plaatsingen = bestaandePerRol.get(rol.id) ?? []
      // Alleen rollen die al "in pipeline" zitten met geplande snijdatums tellen voor stap 1
      // Anders heb je geen vroegere datum dan "nieuwe rol" scenario
      if (plaatsingen.length === 0) continue
      const check = rolHeeftPlek(rol, plaatsingen, nieuwStuk)
      if (!check) continue
      // Snij-datum komt bij voorkeur uit de werkagenda (werkelijke moment in
      // de productie-flow). Fallback op afleverdatum-buffer-logica wanneer
      // de rol om wat voor reden niet in de agenda voorkomt.
      const slot = werkagenda.get(rol.id)
      const snij_datum = slot
        ? slot.klaarDatum
        : snijDatumVoorRol(plaatsingen, cfg.logistieke_buffer_dagen)
      kandidaten.push({
        rol,
        snij_datum,
        is_exact: rol.kwaliteit_code === kwaliteit_code,
        waste_score: check.waste_score,
      })
    }

    const match = kiesBesteMatch({ kandidaten, logistieke_buffer_dagen: cfg.logistieke_buffer_dagen })

    // ---- Stap 2: Capaciteit voor nieuwe rol ----
    const startDatum = gewenste_leverdatum ?? defaultGewensteDatum(cfg.maatwerk_weken)
    const snij = snijWeekVoorLever(startDatum)
    const capaciteit = await capaciteitsCheck({
      start_week: snij.week,
      start_jaar: snij.jaar,
      cfg,
      fetchBezetting: async (week, jaar) => {
        const { data } = await supabase
          .from('snijplannen')
          .select('id, rol_id')
          .eq('planning_week', week)
          .eq('planning_jaar', jaar)
          .neq('status', 'Geannuleerd')
        return (data ?? []) as Array<{ id: number; rol_id: number | null }>
      },
    })

    const backlog = backlogIsVoldoende(backlogRaw, nieuwStukM2, cfg.backlog_minimum_m2)

    // ---- Stap 3: Resolve ----
    const response: CheckLevertijdResponse = resolveScenario({
      match,
      capaciteit,
      backlog,
      cfg,
      gewenste_leverdatum,
      nieuw_stuk_m2: nieuwStukM2,
      geen_rol_passend: geenRolPassend,
    })

    // ---- Stap 4: Spoed-evaluatie (altijd, voor UI-toggle) ----
    const nieuwStukDuur = cfg.wisseltijd_minuten + cfg.snijtijd_minuten
    response.spoed = evalueerSpoed(werkagenda, nieuwStukDuur, cfg, new Date())

    return jsonResponse(response, 200)
  } catch (err) {
    let message: string
    if (err instanceof Error) message = err.message
    else message = String(err)
    console.error('check-levertijd error:', message)
    return jsonResponse({ error: `Levertijd-check fout: ${message}` }, 500)
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function defaultGewensteDatum(maatwerkWeken: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + maatwerkWeken * 7)
  return d.toISOString().slice(0, 10)
}
